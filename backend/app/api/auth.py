import threading
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import TeamMember, User
from ..schemas import (
    LoginIn,
    MeOut,
    PasswordChangeIn,
    TeamMembershipOut,
    TokenOut,
)
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 登录限流：内存里的滑动窗口。
#
# 单进程部署够用；将来 API 多副本时要换成 Redis 或网关层限流，否则每个副本各算各的。
# 两个维度：同一 IP 20 次/分钟（防止换用户名刷），同一 IP+账号 5 次/分钟（防爆破）。
_WINDOW_SECONDS = 60.0
_IP_LIMIT = 20
_ACCOUNT_LIMIT = 5
_attempts: dict[str, deque[float]] = {}
_attempts_lock = threading.Lock()


def _hit(key: str, limit: int) -> bool:
    now = time.monotonic()
    with _attempts_lock:
        bucket = _attempts.setdefault(key, deque())
        while bucket and now - bucket[0] > _WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        # 随机用户名会制造大量 key，攒多了顺手清掉已经空掉的桶
        if len(_attempts) > 4096:
            for stale in [k for k, v in _attempts.items() if not v]:
                _attempts.pop(stale, None)
        return True


def _clear(key: str) -> None:
    with _attempts_lock:
        _attempts.pop(key, None)


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, db: DbSession) -> TokenOut:
    client = request.client.host if request.client else "unknown"
    account_key = f"login:{client}:{body.username}"
    if not _hit(f"login-ip:{client}", _IP_LIMIT) or not _hit(account_key, _ACCOUNT_LIMIT):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "尝试过于频繁，请 1 分钟后再试",
            headers={"Retry-After": "60"},
        )

    stmt = select(User).where(User.username == body.username)
    user = (await db.execute(stmt)).scalar_one_or_none()
    # 用户名不存在与密码错误返回同一个响应，避免用户名枚举
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账号已停用")
    _clear(account_key)
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout() -> None:
    # 无状态 JWT，登出由前端丢弃 token 完成
    return None


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser, db: DbSession) -> MeOut:
    stmt = select(TeamMember).where(TeamMember.user_id == user.id)
    memberships = [
        TeamMembershipOut.model_validate(m) for m in (await db.execute(stmt)).scalars()
    ]
    return MeOut(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        avatar=user.avatar,
        is_active=user.is_active,
        teams=memberships,
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: PasswordChangeIn, user: CurrentUser, db: DbSession) -> None:
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "原密码不正确")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
