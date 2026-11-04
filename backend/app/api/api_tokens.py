"""测试团队 CI Token 管理。"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..ci_tokens import generate_token, parse_scopes
from ..deps import CurrentUser, DbSession, require_team_role
from ..models import TeamApiToken
from ..schemas import ApiTokenCreatedOut, ApiTokenCreateIn, ApiTokenOut

router = APIRouter(tags=["api-tokens"])


def _out(row: TeamApiToken) -> ApiTokenOut:
    return ApiTokenOut(
        id=row.id,
        team_id=row.team_id,
        name=row.name,
        token_prefix=row.token_prefix,
        scopes=sorted(parse_scopes(row.scopes)),
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
    )


@router.get("/api/teams/{team_id}/api-tokens", response_model=list[ApiTokenOut])
async def list_tokens(
    team_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[ApiTokenOut]:
    await require_team_role(team_id, user, db, "admin")
    rows = list(
        (
            await db.execute(
                select(TeamApiToken)
                .where(TeamApiToken.team_id == team_id)
                .order_by(TeamApiToken.created_at.desc())
            )
        ).scalars()
    )
    return [_out(row) for row in rows]


@router.post(
    "/api/teams/{team_id}/api-tokens",
    response_model=ApiTokenCreatedOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_token(
    team_id: uuid.UUID, body: ApiTokenCreateIn, user: CurrentUser, db: DbSession
) -> ApiTokenCreatedOut:
    await require_team_role(team_id, user, db, "admin")
    try:
        scopes = parse_scopes(",".join(body.scopes))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    plaintext, token_hash, prefix = generate_token()
    expires_at = body.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    row = TeamApiToken(
        team_id=team_id,
        name=body.name.strip(),
        token_hash=token_hash,
        token_prefix=prefix,
        scopes=",".join(sorted(scopes)),
        created_by=user.id,
        expires_at=expires_at,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ApiTokenCreatedOut(**_out(row).model_dump(), token=plaintext)


@router.delete(
    "/api/teams/{team_id}/api-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_token(
    team_id: uuid.UUID, token_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    await require_team_role(team_id, user, db, "admin")
    row = await db.get(TeamApiToken, token_id)
    if row is None or row.team_id != team_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token 不存在")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        await db.commit()
