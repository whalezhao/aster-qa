import time
import uuid
from types import SimpleNamespace

import httpx
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..ai_case import call_model
from ..deps import (
    CurrentUser,
    DbSession,
    get_team_membership,
    require_project_access,
    require_team_role,
)
from ..environments import ensure_default_environment, sync_default_environment
from ..model_health import describe_model_error, probe_project
from ..modelconfig import configured_project_ids_stmt, missing_fields, row_configured
from ..models import Project, ProjectModelConfig, ProjectModelHealth
from ..quota import project_month_usage, record_usage
from ..schemas import (
    ModelConfigIn,
    ModelConfigOut,
    ModelConfigTestIn,
    ModelConfigTestOut,
    ProjectCreate,
    ProjectHealthOut,
    ProjectOut,
    ProjectUpdate,
)

router = APIRouter(tags=["projects"])


@router.get("/api/teams/{team_id}/projects", response_model=list[ProjectOut])
async def list_projects(
    team_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[ProjectOut]:
    await get_team_membership(db, team_id, user)
    stmt = select(Project).where(Project.team_id == team_id).order_by(Project.name)
    projects = list((await db.execute(stmt)).scalars())
    # 一次查完所有项目的模型配置状态，避免列表页 N+1
    configured = set((await db.execute(configured_project_ids_stmt())).scalars())
    health = {
        row.project_id: row
        for row in (
            await db.execute(
                select(ProjectModelHealth).where(
                    ProjectModelHealth.project_id.in_([p.id for p in projects])
                )
            )
        ).scalars()
    }
    out = []
    for project in projects:
        item = ProjectOut.model_validate(project)
        item.has_model_config = project.id in configured
        row = health.get(project.id)
        item.model_health = ProjectHealthOut.model_validate(row) if row else None
        out.append(item)
    return out


@router.post(
    "/api/teams/{team_id}/projects",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    team_id: uuid.UUID, body: ProjectCreate, user: CurrentUser, db: DbSession
) -> Project:
    await require_team_role(team_id, user, db, "admin")
    exists = (
        await db.execute(
            select(Project.id).where(Project.team_id == team_id, Project.name == body.name)
        )
    ).first()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该系统名已存在")
    project = Project(team_id=team_id, **body.model_dump())
    db.add(project)
    await db.flush()
    await ensure_default_environment(db, project.id, created_by=user.id)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/api/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ProjectOut:
    project = await require_project_access(db, project_id, user)
    out = ProjectOut.model_validate(project)
    out.has_model_config = row_configured(await db.get(ProjectModelConfig, project_id))
    health = await db.get(ProjectModelHealth, project_id)
    out.model_health = ProjectHealthOut.model_validate(health) if health else None
    return out


@router.patch("/api/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser, db: DbSession
) -> Project:
    project = await require_project_access(db, project_id, user, "admin")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    # 默认环境的地址与 Project.base_url 保持同步，避免两个「默认地址」说法
    await sync_default_environment(db, project)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/api/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    project = await require_project_access(db, project_id, user, "admin")
    await db.delete(project)
    await db.commit()


# --------------------------------------------------------------- 项目级模型配置


@router.get("/api/projects/{project_id}/model-config", response_model=ModelConfigOut)
async def get_model_config(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> ModelConfigOut:
    await require_project_access(db, project_id, user)
    row = await db.get(ProjectModelConfig, project_id)
    return await _to_out(db, row)


@router.put("/api/projects/{project_id}/model-config", response_model=ModelConfigOut)
async def set_model_config(
    project_id: uuid.UUID, body: ModelConfigIn, user: CurrentUser, db: DbSession
) -> ModelConfigOut:
    """设置系统级模型配置。逐字段覆盖全局，留空的字段继续用全局值。"""
    # 写密钥属于敏感操作，要求 admin
    await require_project_access(db, project_id, user, "admin")

    row = await db.get(ProjectModelConfig, project_id)
    if row is None:
        row = ProjectModelConfig(project_id=project_id)
        db.add(row)

    for field in ("model_name", "model_family", "base_url", "init_config_json"):
        value = getattr(body, field)
        if value is not None:
            # 空字符串当「清掉这个字段」处理，否则前端没法把某一项恢复成全局
            setattr(row, field, value.strip() or None)

    if body.clear_api_key:
        row.api_key = None
    elif body.api_key:
        row.api_key = body.api_key.strip() or None

    if body.clear_reasoning:
        row.reasoning_enabled = None
    elif body.reasoning_enabled is not None:
        row.reasoning_enabled = body.reasoning_enabled

    if body.clear_token_quota:
        row.token_quota = None
    elif body.token_quota is not None:
        # 0 等同于不限，省得前端再区分「空」和「零」
        row.token_quota = body.token_quota or None

    row.updated_by = user.id
    # 配置变了，旧的连通性结论就失效了
    health = await db.get(ProjectModelHealth, project_id)
    if health is not None:
        await db.delete(health)
    await db.commit()
    await db.refresh(row)
    return await _to_out(db, row)


@router.post(
    "/api/projects/{project_id}/model-config/test",
    response_model=ModelConfigTestOut,
)
async def test_model_config(
    project_id: uuid.UUID, body: ModelConfigTestIn, user: CurrentUser, db: DbSession
) -> ModelConfigTestOut:
    """用当前表单值实际发一次最小 chat 请求，验证地址、密钥、模型名。

    表单里没填的项回退到已保存的配置，所以「先测再存」和「测已存的」是同一个入口。
    """
    await require_project_access(db, project_id, user)
    row = await db.get(ProjectModelConfig, project_id)

    def pick(value: str | None, saved: str | None) -> str | None:
        return (value or "").strip() or saved

    probe = SimpleNamespace(
        base_url=pick(body.base_url, row.base_url if row else None),
        model_name=pick(body.model_name, row.model_name if row else None),
        api_key=pick(body.api_key, row.api_key if row else None),
        reasoning_enabled=row.reasoning_enabled if row else None,
    )
    if not probe.base_url:
        return ModelConfigTestOut(ok=False, message="还没有填写模型接入地址")
    if not probe.model_name:
        return ModelConfigTestOut(ok=False, message="还没有填写模型名")

    # 测的是已保存配置 —— 结果同时写进健康记录，项目列表/预检共用
    if not (body.base_url or body.model_name or body.api_key):
        health = await probe_project(db, project_id, source="manual")
        return ModelConfigTestOut(
            ok=health.status == "healthy",
            message=health.message or "模型健康检查未通过",
            latency_ms=health.latency_ms or 0,
        )

    timeout = 20.0
    started = time.perf_counter()
    try:
        _content, usage = await call_model(
            probe,
            [{"role": "user", "content": "ping"}],
            timeout=timeout,
            max_tokens=16,
        )
    except (httpx.HTTPError, ValueError) as exc:
        # 测试接口的职责就是把失败原因如实带回去，而不是抛 500
        return ModelConfigTestOut(
            ok=False,
            message=_test_failure(exc, timeout=timeout),
            latency_ms=_elapsed_ms(started),
        )

    # 这一下也会花 token，按平台侧流水记上，避免月用量对不上
    await record_usage(db, project_id, "model_test", usage)
    await db.commit()
    return ModelConfigTestOut(
        ok=True,
        message="连接成功，模型已正常响应",
        latency_ms=_elapsed_ms(started),
    )


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _test_failure(exc: Exception, *, timeout: float) -> str:
    """兼容旧测试的别名；实现集中在 model_health。"""
    return describe_model_error(exc, timeout=timeout)


@router.delete(
    "/api/projects/{project_id}/model-config", status_code=status.HTTP_204_NO_CONTENT
)
async def clear_model_config(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    """整条清掉，该系统回到全局配置。"""
    await require_project_access(db, project_id, user, "admin")
    row = await db.get(ProjectModelConfig, project_id)
    if row is not None:
        await db.delete(row)
    health = await db.get(ProjectModelHealth, project_id)
    if health is not None:
        await db.delete(health)
    if row is not None or health is not None:
        await db.commit()


async def _to_out(db, row: ProjectModelConfig | None) -> ModelConfigOut:
    # 判定口径集中在 modelconfig —— 必须和执行门禁用的是同一套，
    # 否则会出现「页面显示已配置、点执行却被拒绝」
    gaps = missing_fields(row)
    used = await project_month_usage(db, row.project_id) if row else 0
    health = await db.get(ProjectModelHealth, row.project_id) if row else None
    return ModelConfigOut(
        configured=not gaps,
        missing=gaps,
        model_name=row.model_name if row else None,
        model_family=row.model_family if row else None,
        base_url=row.base_url if row else None,
        init_config_json=row.init_config_json if row else None,
        api_key_set=bool(row and row.api_key),
        reasoning_enabled=row.reasoning_enabled if row else None,
        token_quota=row.token_quota if row else None,
        month_tokens_used=used,
        model_health=ProjectHealthOut.model_validate(health) if health else None,
    )
