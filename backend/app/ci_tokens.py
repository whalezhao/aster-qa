"""CI 使用的测试团队 API Token。"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .ids import split_ids
from .models import TeamApiToken

ALLOWED_SCOPES = {"run", "read"}
TOKEN_PREFIX = "aqt_"


@dataclass(frozen=True)
class CIContext:
    token_id: uuid.UUID
    team_id: uuid.UUID
    name: str
    scopes: set[str]


def generate_token() -> tuple[str, str, str]:
    """返回 (明文, sha256, 展示前缀)。明文只在创建响应里出现一次。"""
    plaintext = TOKEN_PREFIX + secrets.token_urlsafe(32)
    return plaintext, hash_token(plaintext), plaintext[:12]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def parse_scopes(raw: str | None) -> set[str]:
    scopes = set(split_ids(raw)) or {"run", "read"}
    unknown = scopes - ALLOWED_SCOPES
    if unknown:
        raise ValueError(f"未知 scope：{'、'.join(sorted(unknown))}")
    return scopes


async def authenticate(db: AsyncSession, token: str) -> CIContext:
    token = (token or "").strip()
    if not token.startswith(TOKEN_PREFIX):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效的 API Token")
    row = (
        await db.execute(
            select(TeamApiToken).where(TeamApiToken.token_hash == hash_token(token))
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    if row is None or row.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API Token 已失效")
    if row.expires_at is not None and row.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API Token 已过期")

    if row.last_used_at is None or row.last_used_at < now - timedelta(seconds=60):
        row.last_used_at = now
        await db.commit()
    return CIContext(
        token_id=row.id,
        team_id=row.team_id,
        name=row.name,
        scopes=parse_scopes(row.scopes),
    )


def require_scope(ctx: CIContext, scope: str) -> None:
    if scope not in ctx.scopes:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"该 Token 没有 {scope} 权限"
        )
