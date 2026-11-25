"""环境级登录会话保持配置与缓存状态。"""

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..config import get_settings
from ..deps import CurrentUser, DbSession
from ..models import (
    Feature,
    ProjectEnvironment,
    ProjectSessionConfig,
    ProjectSessionState,
    TestCase,
)
from ..runner import session as session_mod
from ..schemas import SessionConfigIn, SessionConfigOut, SessionStateOut
from ..yamlcheck import validate as validate_yaml
from .environments import _require_env

router = APIRouter(tags=["session"])


async def _case_in_project(db, project_id: uuid.UUID, case_id: uuid.UUID) -> TestCase | None:
    return (
        await db.execute(
            select(TestCase)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(TestCase.id == case_id, Feature.project_id == project_id)
        )
    ).scalar_one_or_none()


async def _out(db, env: ProjectEnvironment) -> SessionConfigOut:
    config = await db.get(ProjectSessionConfig, env.id)
    login_case = (
        await db.get(TestCase, config.login_case_id)
        if config is not None and config.login_case_id
        else None
    )
    check_case = (
        await db.get(TestCase, config.check_case_id)
        if config is not None and config.check_case_id
        else None
    )
    state = (
        await db.execute(
            select(ProjectSessionState).where(
                ProjectSessionState.project_id == env.project_id,
                ProjectSessionState.environment_id == env.id,
            )
        )
    ).scalar_one_or_none()
    return SessionConfigOut(
        project_id=env.project_id,
        environment_id=env.id,
        enabled=config.enabled if config is not None else False,
        login_case_id=config.login_case_id if config is not None else None,
        check_case_id=config.check_case_id if config is not None else None,
        login_case_name=login_case.name if login_case is not None else None,
        check_case_name=check_case.name if check_case is not None else None,
        ttl_seconds=config.ttl_seconds if config is not None else 1800,
        retry_on_expiry=config.retry_on_expiry if config is not None else True,
        states=(
            [
                SessionStateOut(
                    environment_id=env.id,
                    environment_name=env.name,
                    refreshed_at=state.refreshed_at,
                    last_used_at=state.last_used_at,
                    last_error=state.last_error,
                )
            ]
            if state is not None
            else []
        ),
    )


@router.get(
    "/api/environments/{environment_id}/session-config",
    response_model=SessionConfigOut,
)
async def get_session_config(
    environment_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> SessionConfigOut:
    env, _project = await _require_env(db, environment_id, user)
    return await _out(db, env)


@router.put(
    "/api/environments/{environment_id}/session-config",
    response_model=SessionConfigOut,
)
async def set_session_config(
    environment_id: uuid.UUID,
    body: SessionConfigIn,
    user: CurrentUser,
    db: DbSession,
) -> SessionConfigOut:
    env, project = await _require_env(db, environment_id, user, "admin")
    login_case = None
    if body.login_case_id:
        login_case = await _case_in_project(db, project.id, body.login_case_id)
        if login_case is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "登录用例不属于该系统")
        errors, case_count = validate_yaml(login_case.yaml_content)
        if errors:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "登录用例 YAML 不合法：" + "；".join(errors),
            )
        if case_count != 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "登录会话用例必须是单 case 的 YAML 文档",
            )
    check_case = None
    if body.check_case_id:
        check_case = await _case_in_project(db, project.id, body.check_case_id)
        if check_case is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "检查用例不属于该系统")
    if body.enabled and login_case is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "启用会话保持前请选择登录用例")

    config = await db.get(ProjectSessionConfig, env.id)
    if config is None:
        config = ProjectSessionConfig(
            environment_id=env.id,
            project_id=env.project_id,
            created_by=user.id,
        )
        db.add(config)
    config.login_case_id = login_case.id if login_case is not None else None
    config.check_case_id = check_case.id if check_case is not None else None
    config.enabled = body.enabled
    config.ttl_seconds = body.ttl_seconds
    config.retry_on_expiry = body.retry_on_expiry
    config.updated_by = user.id
    if not body.enabled:
        state = (
            await db.execute(
                select(ProjectSessionState).where(
                    ProjectSessionState.project_id == env.project_id,
                    ProjectSessionState.environment_id == env.id,
                )
            )
        ).scalar_one_or_none()
        session_mod.remove_session(
            get_settings().runner_path, env.project_id, env.id
        )
        if state is not None:
            await db.delete(state)
    await db.commit()
    return await _out(db, env)


@router.delete(
    "/api/environments/{environment_id}/session-state",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_session_state(
    environment_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    env, _project = await _require_env(db, environment_id, user, "admin")
    state = (
        await db.execute(
            select(ProjectSessionState).where(
                ProjectSessionState.project_id == env.project_id,
                ProjectSessionState.environment_id == env.id,
            )
        )
    ).scalar_one_or_none()
    session_mod.remove_session(get_settings().runner_path, env.project_id, env.id)
    if state is not None:
        await db.delete(state)
    await db.commit()