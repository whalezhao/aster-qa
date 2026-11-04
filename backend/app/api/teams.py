import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession, get_team_membership, require_team_role, visible_team_ids
from ..models import Team, TeamMember, User
from ..schemas import MemberAdd, MemberOut, MemberUpdate, TeamCreate, TeamOut, TeamUpdate

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
async def list_teams(user: CurrentUser, db: DbSession) -> list[Team]:
    ids = await visible_team_ids(db, user)
    if not ids:
        return []
    stmt = select(Team).where(Team.id.in_(ids)).order_by(Team.name)
    return list((await db.execute(stmt)).scalars())


@router.post("", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
async def create_team(body: TeamCreate, user: CurrentUser, db: DbSession) -> Team:
    if (await db.execute(select(Team.id).where(Team.name == body.name))).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "测试团队名已存在")
    team = Team(name=body.name, description=body.description)
    db.add(team)
    await db.flush()
    # 建团队的人自动成为 owner，否则新团队无人可管理
    db.add(TeamMember(team_id=team.id, user_id=user.id, role="owner"))
    await db.commit()
    await db.refresh(team)
    return team


@router.get("/{team_id}", response_model=TeamOut)
async def get_team(team_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Team:
    await get_team_membership(db, team_id, user)
    team = await db.get(Team, team_id)
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "测试团队不存在")
    return team


@router.patch("/{team_id}", response_model=TeamOut)
async def update_team(
    team_id: uuid.UUID, body: TeamUpdate, user: CurrentUser, db: DbSession
) -> Team:
    await require_team_role(team_id, user, db, "admin")
    team = await db.get(Team, team_id)
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "测试团队不存在")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(team, field, value)
    await db.commit()
    await db.refresh(team)
    return team


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(team_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    await require_team_role(team_id, user, db, "owner")
    team = await db.get(Team, team_id)
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "测试团队不存在")
    await db.delete(team)
    await db.commit()


# --------------------------------------------------------------------------- 成员


@router.get("/{team_id}/members", response_model=list[MemberOut])
async def list_members(team_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[MemberOut]:
    await get_team_membership(db, team_id, user)
    stmt = (
        select(TeamMember, User)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id == team_id)
        .order_by(User.username)
    )
    return [
        MemberOut(user_id=m.user_id, role=m.role, user=u) for m, u in (await db.execute(stmt)).all()
    ]


@router.post("/{team_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(
    team_id: uuid.UUID, body: MemberAdd, user: CurrentUser, db: DbSession
) -> MemberOut:
    await require_team_role(team_id, user, db, "admin")
    if body.role not in {"owner", "admin", "member"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法角色")
    target = await db.get(User, body.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    existing = (
        await db.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id, TeamMember.user_id == body.user_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该用户已在测试团队中")
    member = TeamMember(team_id=team_id, user_id=body.user_id, role=body.role)
    db.add(member)
    await db.commit()
    return MemberOut(user_id=member.user_id, role=member.role, user=target)


@router.patch("/{team_id}/members/{user_id}", response_model=MemberOut)
async def update_member(
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberUpdate,
    user: CurrentUser,
    db: DbSession,
) -> MemberOut:
    await require_team_role(team_id, user, db, "admin")
    if body.role not in {"owner", "admin", "member"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法角色")
    member = await get_team_membership(db, team_id, user_id)
    await _guard_last_owner(db, team_id, member, body.role)
    member.role = body.role
    await db.commit()
    target = await db.get(User, user_id)
    return MemberOut(user_id=member.user_id, role=member.role, user=target)


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    team_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    await require_team_role(team_id, user, db, "admin")
    member = await get_team_membership(db, team_id, user_id)
    await _guard_last_owner(db, team_id, member, None)
    await db.delete(member)
    await db.commit()


async def _guard_last_owner(db, team_id, member, new_role: str | None) -> None:
    """不允许把测试团队最后一个 owner 降级或移出，否则测试团队永久失去管理权。"""
    if member.role != "owner" or new_role == "owner":
        return
    owners = (
        await db.execute(
            select(TeamMember.id).where(
                TeamMember.team_id == team_id, TeamMember.role == "owner"
            )
        )
    ).all()
    if len(owners) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "测试团队至少需要保留一名 owner")
