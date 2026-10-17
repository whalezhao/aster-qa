"""认证与授权依赖。这是信任边界，校验要严。"""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .models import Feature, Project, TeamMember, TestCase, User
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]

# 角色蕴含关系：owner 拥有一切，admin 拥有 member 的一切
ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}


async def get_current_user(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "缺少凭证")
    user_id = decode_access_token(creds.credentials)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "凭证无效或已过期")
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "凭证无效") from None
    user = await db.get(User, uid)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在或已停用")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_team_membership(
    db: AsyncSession, team_id: uuid.UUID, user: User | uuid.UUID
) -> TeamMember:
    """传 User 是「查我自己的成员关系」，传 UUID 是「查某个成员」。

    更新 / 移除成员时手里只有目标的 user_id（team_id + user_id 本来就是这个表的语义），
    之前这里只认 User 对象，那两条路径一律 AttributeError -> 500。
    """
    user_id = user if isinstance(user, uuid.UUID) else user.id
    stmt = select(TeamMember).where(
        TeamMember.team_id == team_id, TeamMember.user_id == user_id
    )
    member = (await db.execute(stmt)).scalar_one_or_none()
    if member is None:
        # 不区分「团队不存在」和「你不是成员」，避免泄露团队是否存在
        raise HTTPException(status.HTTP_404_NOT_FOUND, "团队不存在")
    return member


async def require_team_role(
    team_id: uuid.UUID, user: User, db: AsyncSession, minimum: str = "member"
) -> uuid.UUID:
    member = await get_team_membership(db, team_id, user)
    if ROLE_RANK[member.role] < ROLE_RANK[minimum]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"需要 {minimum} 及以上权限")
    return team_id


def team_role_guard(minimum: str = "member"):
    """生成一个校验「当前用户在该团队中至少有 minimum 角色」的依赖。

    路径参数必须叫 team_id。
    """

    async def guard(team_id: uuid.UUID, user: CurrentUser, db: DbSession) -> uuid.UUID:
        return await require_team_role(team_id, user, db, minimum)

    return guard


async def visible_team_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    stmt = select(TeamMember.team_id).where(TeamMember.user_id == user.id)
    return list((await db.execute(stmt)).scalars())


async def require_people_admin(db: AsyncSession, user: User) -> None:
    """人员维护（建号 / 改资料 / 重置密码 / 停用）的权限口径。

    平台没有全局管理员，团队里的 owner/admin 是唯一的「管理者」来源，所以规则是
    **在任一团队里是 owner 或 admin** 即可维护人员。不按团队隔离 —— 人员是全局实体，
    建号是为了把人加进团队，按团队隔离会让「加一个新人」这件事做不成。
    """
    stmt = (
        select(TeamMember.id)
        .where(TeamMember.user_id == user.id, TeamMember.role.in_(("owner", "admin")))
        .limit(1)
    )
    if (await db.execute(stmt)).first() is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "需要团队管理员权限")


# ---------------------------------------------- 沿父子链上溯到 team 再判权限
# features / cases 都通过这条链继承团队的可见性，避免在路由里重复拼 join。


async def require_project_access(
    db: AsyncSession, project_id: uuid.UUID, user: User, minimum: str = "member"
) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    await require_team_role(project.team_id, user, db, minimum)
    return project


async def require_feature_access(
    db: AsyncSession, feature_id: uuid.UUID, user: User, minimum: str = "member"
) -> Feature:
    feature = await db.get(Feature, feature_id)
    if feature is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "功能不存在")
    project = await db.get(Project, feature.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "功能所属项目不存在")
    await require_team_role(project.team_id, user, db, minimum)
    return feature


async def require_case_access(
    db: AsyncSession, case_id: uuid.UUID, user: User, minimum: str = "member"
) -> TestCase:
    case = await db.get(TestCase, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用例不存在")
    feature = await db.get(Feature, case.feature_id)
    if feature is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用例所属功能不存在")
    project = await db.get(Project, feature.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用例所属项目不存在")
    await require_team_role(project.team_id, user, db, minimum)
    # effective_stage 派生自 feature，序列化前必须已加载，否则触发异步懒加载报错
    case.feature = feature
    return case
