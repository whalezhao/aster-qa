import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import CurrentUser, DbSession, require_people_admin, visible_team_ids
from ..models import Team, TeamMember, User
from ..schemas import UserCreate, UserOut, UserTeamOut, UserUpdate
from ..security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])

# 谁能维护人员：见 deps.require_people_admin（任一团队的 owner/admin）。
# 读列表不设限 —— 加团队成员时得能按用户名搜到人，否则新人永远加不进来。


@router.get("", response_model=list[UserOut])
async def list_users(
    user: CurrentUser, db: DbSession, with_teams: bool = False
) -> list[UserOut]:
    """with_teams=1 时附带「属于哪些团队」。

    团队列表只含调用者自己看得到的团队 —— 否则一个团队的管理员能从用户列表里
    反推出别的团队有哪些人、都是什么角色。
    """
    users = list((await db.execute(select(User).order_by(User.username))).scalars())
    if not with_teams:
        return [UserOut.model_validate(u) for u in users]

    scope = await visible_team_ids(db, user)
    rows = []
    if scope:  # 一个团队都没有时别去查 IN ()，直接给空
        rows = (
            await db.execute(
                select(TeamMember.user_id, Team.id, Team.name, TeamMember.role)
                .join(Team, Team.id == TeamMember.team_id)
                .where(TeamMember.team_id.in_(scope))
            )
        ).all()
    by_user: dict[uuid.UUID, list[UserTeamOut]] = {}
    for uid, team_id, team_name, role in rows:
        by_user.setdefault(uid, []).append(UserTeamOut(id=team_id, name=team_name, role=role))

    items = []
    for u in users:
        item = UserOut.model_validate(u)
        item.teams = sorted(by_user.get(u.id, []), key=lambda t: t.name)
        items.append(item)
    return items


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, user: CurrentUser, db: DbSession) -> User:
    # 建账号等于发一把能登录的钥匙，只有团队管理员能发
    await require_people_admin(db, user)
    clashes = [User.username == body.username]
    if body.email:
        clashes.append(User.email == body.email)
    if (await db.execute(select(User.id).where(or_(*clashes)))).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "用户名或邮箱已被占用")
    created = User(
        username=body.username,
        email=body.email,
        display_name=body.display_name,
        avatar=body.avatar,
        password_hash=hash_password(body.password),
    )
    db.add(created)
    await db.commit()
    await db.refresh(created)
    return created


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID, body: UserUpdate, user: CurrentUser, db: DbSession
) -> User:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")

    fields = body.model_dump(exclude_unset=True)
    if target.id == user.id:
        # 自己的资料自己改（含改密码），但停用自己会当场把自己锁在外面
        if fields.get("is_active") is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能停用自己的账号")
    else:
        # 改别人的资料、重置别人的密码 —— 这是管理员操作，不是普通成员能干的
        await require_people_admin(db, user)
        if fields.get("is_active") is False:
            await _guard_team_without_owner(db, target)

    for field, value in fields.items():
        if field == "password":
            target.password_hash = hash_password(value)
        else:
            setattr(target, field, value)
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """物理删除账号。停用走 PATCH is_active，这里是真的删。

    历史数据里的 created_by / 签名人都是 SET NULL，所以删完那些记录还在，
    只是「谁做的」变成空。团队关系靠 CASCADE 一起清掉。
    """
    if user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能删除自己")
    await require_people_admin(db, user)
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    # 删掉某团队最后一个 owner，那个团队以后就没人能管了 —— 和停用是同一条保护
    await _guard_team_without_owner(db, target)
    await db.delete(target)
    await db.commit()


@router.get("/{user_id}/teams", response_model=list[uuid.UUID])
async def user_teams(user_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[uuid.UUID]:
    stmt = select(TeamMember.team_id).where(TeamMember.user_id == user_id)
    return list((await db.execute(stmt)).scalars())


async def _guard_team_without_owner(db: AsyncSession, target: User) -> None:
    """停用某团队最后一个还能登录的 owner，会让那个团队以后再没人能管。

    和「移除成员」那条路上的 _guard_last_owner 是同一个道理，只是这里换成了停用账号。
    """
    team_ids = (
        (
            await db.execute(
                select(TeamMember.team_id).where(
                    TeamMember.user_id == target.id, TeamMember.role == "owner"
                )
            )
        )
        .scalars()
        .all()
    )
    for team_id in team_ids:
        others = (
            await db.execute(
                select(func.count())
                .select_from(TeamMember)
                .join(User, User.id == TeamMember.user_id)
                .where(
                    TeamMember.team_id == team_id,
                    TeamMember.role == "owner",
                    TeamMember.user_id != target.id,
                    User.is_active.is_(True),
                )
            )
        ).scalar_one()
        if others == 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "该用户是某个测试团队唯一的 owner，停用后测试团队将无人可管理",
            )
