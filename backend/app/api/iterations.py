import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession, get_team_membership, require_team_role, visible_team_ids
from ..models import Iteration
from ..schemas import IterationCreate, IterationOut, IterationUpdate

router = APIRouter(tags=["iterations"])


async def _require_iteration(db, iteration_id: uuid.UUID, user, minimum: str = "member") -> Iteration:
    iteration = await db.get(Iteration, iteration_id)
    if iteration is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "迭代不存在")
    await require_team_role(iteration.team_id, user, db, minimum)
    return iteration


@router.get("/api/teams/{team_id}/iterations", response_model=list[IterationOut])
async def list_iterations(
    team_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[Iteration]:
    await get_team_membership(db, team_id, user)
    stmt = (
        select(Iteration)
        .where(Iteration.team_id == team_id)
        .order_by(Iteration.start_date.desc().nullslast(), Iteration.name)
    )
    return list((await db.execute(stmt)).scalars())


@router.post(
    "/api/teams/{team_id}/iterations",
    response_model=IterationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_iteration(
    team_id: uuid.UUID, body: IterationCreate, user: CurrentUser, db: DbSession
) -> Iteration:
    await require_team_role(team_id, user, db, "admin")
    exists = (
        await db.execute(
            select(Iteration.id).where(
                Iteration.team_id == team_id, Iteration.name == body.name
            )
        )
    ).first()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该迭代名已存在")
    iteration = Iteration(team_id=team_id, **body.model_dump())
    db.add(iteration)
    await db.commit()
    await db.refresh(iteration)
    return iteration


@router.patch("/api/iterations/{iteration_id}", response_model=IterationOut)
async def update_iteration(
    iteration_id: uuid.UUID, body: IterationUpdate, user: CurrentUser, db: DbSession
) -> Iteration:
    iteration = await _require_iteration(db, iteration_id, user, "admin")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(iteration, field, value)
    await db.commit()
    await db.refresh(iteration)
    return iteration


@router.delete("/api/iterations/{iteration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_iteration(
    iteration_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    iteration = await _require_iteration(db, iteration_id, user, "admin")
    await db.delete(iteration)
    await db.commit()


@router.get("/api/iterations", response_model=list[IterationOut])
async def list_my_iterations(user: CurrentUser, db: DbSession) -> list[Iteration]:
    """跨测试团队列出当前用户可见的全部迭代 —— 统计页和标签选择器需要。"""
    ids = await visible_team_ids(db, user)
    if not ids:
        return []
    stmt = (
        select(Iteration)
        .where(Iteration.team_id.in_(ids))
        .order_by(Iteration.start_date.desc().nullslast())
    )
    return list((await db.execute(stmt)).scalars())
