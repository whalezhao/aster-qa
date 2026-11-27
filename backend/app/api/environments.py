"""系统环境与变量。"""

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..config import get_settings
from ..crypto import encrypt_secret
from ..deps import CurrentUser, DbSession, require_project_access, require_team_role
from ..environments import (
    DEFAULT_ENVIRONMENT,
    ensure_default_environment,
    validate_variable_key,
)
from ..models import (
    Project,
    ProjectEnvironment,
    ProjectEnvironmentVariable,
    ProjectFile,
    TestTask,
)
from ..project_files import resolve_storage_path
from ..runner import session as session_mod
from ..schemas import (
    EnvironmentIn,
    EnvironmentOut,
    EnvironmentUpdate,
    EnvironmentVariableOut,
    EnvironmentVariablesIn,
)

router = APIRouter(tags=["environments"])


async def _require_env(db, environment_id: uuid.UUID, user, minimum: str = "member"):
    env = await db.get(ProjectEnvironment, environment_id)
    if env is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "环境不存在")
    project = await require_project_access(db, env.project_id, user, minimum)
    return env, project


async def _variables(db, environment_id: uuid.UUID) -> list[EnvironmentVariableOut]:
    rows = list(
        (
            await db.execute(
                select(ProjectEnvironmentVariable)
                .where(ProjectEnvironmentVariable.environment_id == environment_id)
                .order_by(ProjectEnvironmentVariable.key)
            )
        ).scalars()
    )
    return [
        EnvironmentVariableOut(
            id=row.id,
            key=row.key,
            value=None if row.is_secret or row.value_mode != "fixed" else row.value,
            value_mode=row.value_mode,
            random_length=row.random_length,
            is_secret=row.is_secret,
            value_set=row.value_mode == "fixed" and bool(row.value),
            description=row.description,
        )
        for row in rows
    ]


async def _env_out(db, env: ProjectEnvironment) -> EnvironmentOut:
    return EnvironmentOut(
        id=env.id,
        project_id=env.project_id,
        name=env.name,
        base_url=env.base_url,
        proxy_url=env.proxy_url,
        is_default=env.is_default,
        variables=await _variables(db, env.id),
    )


@router.get(
    "/api/projects/{project_id}/environments", response_model=list[EnvironmentOut]
)
async def list_environments(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[EnvironmentOut]:
    await require_project_access(db, project_id, user)
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "系统不存在")
    await ensure_default_environment(db, project_id)
    await db.commit()
    rows = list(
        (
            await db.execute(
                select(ProjectEnvironment)
                .where(ProjectEnvironment.project_id == project_id)
                .order_by(ProjectEnvironment.is_default.desc(), ProjectEnvironment.name)
            )
        ).scalars()
    )
    return [await _env_out(db, row) for row in rows]


@router.get("/api/teams/{team_id}/environments", response_model=list[EnvironmentOut])
async def list_team_environments(
    team_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[EnvironmentOut]:
    await require_team_role(team_id, user, db)
    rows = list(
        (
            await db.execute(
                select(ProjectEnvironment)
                .join(Project, Project.id == ProjectEnvironment.project_id)
                .where(Project.team_id == team_id)
                .order_by(Project.name, ProjectEnvironment.name)
            )
        ).scalars()
    )
    return [await _env_out(db, row) for row in rows]


@router.post(
    "/api/projects/{project_id}/environments",
    response_model=EnvironmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_environment(
    project_id: uuid.UUID,
    body: EnvironmentIn,
    user: CurrentUser,
    db: DbSession,
) -> EnvironmentOut:
    await require_project_access(db, project_id, user, "admin")
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "系统不存在")
    name = body.name.strip()
    if name == DEFAULT_ENVIRONMENT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "「默认」环境已存在")
    exists = (
        await db.execute(
            select(ProjectEnvironment.id).where(
                ProjectEnvironment.project_id == project_id,
                ProjectEnvironment.name == name,
            )
        )
    ).first()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "同名环境已存在")
    env = ProjectEnvironment(
        project_id=project_id,
        name=name,
        base_url=(body.base_url or "").strip() or None,
        proxy_url=(body.proxy_url or "").strip() or None,
        is_default=False,
        created_by=user.id,
    )
    db.add(env)
    await db.commit()
    await db.refresh(env)
    return await _env_out(db, env)


@router.patch("/api/environments/{environment_id}", response_model=EnvironmentOut)
async def update_environment(
    environment_id: uuid.UUID,
    body: EnvironmentUpdate,
    user: CurrentUser,
    db: DbSession,
) -> EnvironmentOut:
    env, project = await _require_env(db, environment_id, user, "admin")
    if body.name is not None and body.name.strip() != env.name:
        if env.is_default:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "默认环境不能改名")
        new_name = body.name.strip()
        used = (
            await db.execute(
                select(TestTask.id).where(
                    TestTask.team_id == project.team_id,
                    TestTask.environment_name == env.name,
                )
            )
        ).first()
        if used is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "仍有任务在使用这个环境名，不能改名"
            )
        duplicate = (
            await db.execute(
                select(ProjectEnvironment.id).where(
                    ProjectEnvironment.project_id == env.project_id,
                    ProjectEnvironment.name == new_name,
                    ProjectEnvironment.id != env.id,
                )
            )
        ).first()
        if duplicate is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "同名环境已存在")
        env.name = new_name

    if body.base_url is not None:
        if env.is_default:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "默认环境的地址跟随系统 Base URL，请到系统设置修改",
            )
        env.base_url = body.base_url.strip() or None
    if body.proxy_url is not None:
        env.proxy_url = body.proxy_url.strip() or None
    await db.commit()
    await db.refresh(env)
    return await _env_out(db, env)


@router.delete(
    "/api/environments/{environment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_environment(
    environment_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    env, project = await _require_env(db, environment_id, user, "admin")
    if env.is_default:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "默认环境不能删除")
    used = (
        await db.execute(
            select(TestTask.id).where(
                TestTask.team_id == project.team_id,
                TestTask.environment_name == env.name,
            )
        )
    ).first()
    if used is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "仍有任务在使用这个环境，不能删除"
        )
    file_rows = list(
        (
            await db.execute(
                select(ProjectFile).where(ProjectFile.environment_id == env.id)
            )
        ).scalars()
    )
    settings = get_settings()
    file_paths = []
    for row in file_rows:
        try:
            file_paths.append(resolve_storage_path(settings.assets_path, row.storage_path))
        except ValueError:
            pass
    await db.delete(env)
    await db.commit()
    session_mod.remove_session(settings.runner_path, project.id, environment_id)
    for path in file_paths:
        path.unlink(missing_ok=True)
        try:
            path.parent.rmdir()
        except OSError:
            pass


@router.put(
    "/api/environments/{environment_id}/variables", response_model=EnvironmentOut
)
async def set_variables(
    environment_id: uuid.UUID,
    body: EnvironmentVariablesIn,
    user: CurrentUser,
    db: DbSession,
) -> EnvironmentOut:
    env, _project = await _require_env(db, environment_id, user, "admin")
    existing = {
        row.key: row
        for row in (
            await db.execute(
                select(ProjectEnvironmentVariable).where(
                    ProjectEnvironmentVariable.environment_id == env.id
                )
            )
        ).scalars()
    }
    seen: set[str] = set()
    for item in body.variables:
        try:
            key = validate_variable_key(item.key, is_secret=item.is_secret)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        if key in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"变量 {key} 重复")
        seen.add(key)
        row = existing.get(key)
        if item.clear:
            if row is not None:
                await db.delete(row)
            continue

        # 旧客户端不传 value_mode：新变量按 fixed，已有变量保留原模式
        mode = item.value_mode or (row.value_mode if row is not None else "fixed")
        if (
            row is not None
            and row.value_mode != "fixed"
            and mode == "fixed"
            and not item.value
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"变量 {key} 从随机变量切换为固定值时必须填写值",
            )
        random_length = None
        if mode != "fixed":
            random_length = item.random_length
            if random_length is None and item.value_mode is None and row is not None:
                random_length = row.random_length
            if random_length is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"变量 {key} 是随机变量，长度必须在 1-128 之间",
                )

        if row is None:
            row = ProjectEnvironmentVariable(
                environment_id=env.id,
                key=key,
                is_secret=item.is_secret,
                value_mode=mode,
                random_length=random_length,
            )
            db.add(row)
        row.value_mode = mode
        row.random_length = random_length
        row.is_secret = item.is_secret
        if mode != "fixed":
            # 随机变量不存值：旧明文/旧密文一起清掉
            row.value = None
        elif item.is_secret:
            # 密钥留空 = 不改；新建时必须给值，否则存一个空密钥没有意义
            if item.value:
                row.value = encrypt_secret(item.value)
            elif row.value is None:
                row.value = ""
        else:
            row.value = item.value or ""
        row.description = item.description
    await db.commit()
    await db.refresh(env)
    return await _env_out(db, env)
