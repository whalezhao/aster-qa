import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession, get_team_membership, require_team_role, visible_team_ids
from ..models import Iteration, Tag
from ..schemas import TagCreate, TagOut, TagUpdate

router = APIRouter(tags=["tags"])


async def _require_tag(db, tag_id: uuid.UUID, user, minimum: str = "member") -> Tag:
    tag = await db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "标签不存在")
    await require_team_role(tag.team_id, user, db, minimum)
    return tag


async def _check_iteration_belongs(db, iteration_id: uuid.UUID | None, team_id: uuid.UUID) -> None:
    if iteration_id is None:
        return
    iteration = await db.get(Iteration, iteration_id)
    if iteration is None or iteration.team_id != team_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "迭代不存在或不属于该团队")


@router.get("/api/teams/{team_id}/tags", response_model=list[TagOut])
async def list_tags(team_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[Tag]:
    await get_team_membership(db, team_id, user)
    stmt = select(Tag).where(Tag.team_id == team_id).order_by(Tag.name)
    return list((await db.execute(stmt)).scalars())


@router.get("/api/tags", response_model=list[TagOut])
async def list_my_tags(user: CurrentUser, db: DbSession) -> list[Tag]:
    ids = await visible_team_ids(db, user)
    if not ids:
        return []
    stmt = select(Tag).where(Tag.team_id.in_(ids)).order_by(Tag.name)
    return list((await db.execute(stmt)).scalars())


@router.post(
    "/api/teams/{team_id}/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED
)
async def create_tag(
    team_id: uuid.UUID, body: TagCreate, user: CurrentUser, db: DbSession
) -> Tag:
    await require_team_role(team_id, user, db, "member")
    await _check_iteration_belongs(db, body.iteration_id, team_id)
    exists = (
        await db.execute(select(Tag.id).where(Tag.team_id == team_id, Tag.name == body.name))
    ).first()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该标签名已存在")
    tag = Tag(team_id=team_id, **body.model_dump())
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.patch("/api/tags/{tag_id}", response_model=TagOut)
async def update_tag(
    tag_id: uuid.UUID, body: TagUpdate, user: CurrentUser, db: DbSession
) -> Tag:
    tag = await _require_tag(db, tag_id, user, "member")
    data = body.model_dump(exclude_unset=True)
    if "iteration_id" in data:
        await _check_iteration_belongs(db, data["iteration_id"], tag.team_id)
    for field, value in data.items():
        setattr(tag, field, value)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/api/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    tag = await _require_tag(db, tag_id, user, "member")
    await db.delete(tag)
    await db.commit()
