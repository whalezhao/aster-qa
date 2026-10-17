import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import (
    CurrentUser,
    DbSession,
    get_team_membership,
    require_project_access,
    require_team_role,
)
from ..modelconfig import configured_project_ids_stmt, missing_fields, row_configured
from ..models import Project, ProjectModelConfig
from ..quota import project_month_usage
from ..schemas import (
    ModelConfigIn,
    ModelConfigOut,
    ProjectCreate,
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
    out = []
    for project in projects:
        item = ProjectOut.model_validate(project)
        item.has_model_config = project.id in configured
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
        raise HTTPException(status.HTTP_409_CONFLICT, "该项目名已存在")
    project = Project(team_id=team_id, **body.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/api/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ProjectOut:
    project = await require_project_access(db, project_id, user)
    out = ProjectOut.model_validate(project)
    out.has_model_config = row_configured(await db.get(ProjectModelConfig, project_id))
    return out


@router.patch("/api/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser, db: DbSession
) -> Project:
    project = await require_project_access(db, project_id, user, "admin")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
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
    """设置项目级模型配置。逐字段覆盖全局，留空的字段继续用全局值。"""
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
    await db.commit()
    await db.refresh(row)
    return await _to_out(db, row)


@router.delete(
    "/api/projects/{project_id}/model-config", status_code=status.HTTP_204_NO_CONTENT
)
async def clear_model_config(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    """整条清掉，该项目回到全局配置。"""
    await require_project_access(db, project_id, user, "admin")
    row = await db.get(ProjectModelConfig, project_id)
    if row is not None:
        await db.delete(row)
        await db.commit()


async def _to_out(db, row: ProjectModelConfig | None) -> ModelConfigOut:
    # 判定口径集中在 modelconfig —— 必须和执行门禁用的是同一套，
    # 否则会出现「页面显示已配置、点执行却被拒绝」
    gaps = missing_fields(row)
    used = await project_month_usage(db, row.project_id) if row else 0
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
    )
