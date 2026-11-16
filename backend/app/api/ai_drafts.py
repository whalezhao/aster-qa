"""AI 对话草稿的持久化。

以前对话只存在浏览器 localStorage 里，换浏览器、清缓存、换机器就看不到之前的沟通。
现在按「用户 + 用例（修改）/ 功能（新建）」落库，打开页面直接续上。

草稿是个人数据：每个用户只能读写自己的那一份，不做团队共享。
"""

import uuid

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import CurrentUser, DbSession, require_case_access, require_feature_access
from ..models import CaseAiDraft, User
from ..schemas import AiDraftIn, AiDraftOut

router = APIRouter(tags=["ai-drafts"])


async def _load(
    db: AsyncSession,
    user: User,
    *,
    case_id: uuid.UUID | None = None,
    feature_id: uuid.UUID | None = None,
) -> CaseAiDraft | None:
    stmt = select(CaseAiDraft).where(CaseAiDraft.user_id == user.id)
    if case_id is not None:
        stmt = stmt.where(CaseAiDraft.case_id == case_id)
    else:
        stmt = stmt.where(CaseAiDraft.feature_id == feature_id)
    return (await db.execute(stmt)).scalar_one_or_none()


def _out(draft: CaseAiDraft | None) -> AiDraftOut:
    if draft is None:
        return AiDraftOut()
    state = draft.state or {}
    return AiDraftOut(
        messages=state.get("messages") or [],
        yaml=state.get("yaml"),
        input=state.get("input") or "",
    )


async def _save(
    db: AsyncSession,
    user: User,
    body: AiDraftIn,
    *,
    case_id: uuid.UUID | None = None,
    feature_id: uuid.UUID | None = None,
) -> AiDraftOut:
    draft = await _load(db, user, case_id=case_id, feature_id=feature_id)
    if draft is None:
        draft = CaseAiDraft(
            user_id=user.id, case_id=case_id, feature_id=feature_id, state={}
        )
        db.add(draft)
    draft.state = body.model_dump()
    await db.commit()
    return _out(draft)


# ------------------------------------------------------------------- 用例（修改）


@router.get("/api/cases/{case_id}/ai-draft", response_model=AiDraftOut)
async def get_case_draft(
    case_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> AiDraftOut:
    await require_case_access(db, case_id, user)
    return _out(await _load(db, user, case_id=case_id))


@router.put("/api/cases/{case_id}/ai-draft", response_model=AiDraftOut)
async def put_case_draft(
    case_id: uuid.UUID, body: AiDraftIn, user: CurrentUser, db: DbSession
) -> AiDraftOut:
    await require_case_access(db, case_id, user)
    return await _save(db, user, body, case_id=case_id)


# ------------------------------------------------------------------- 功能（新建）


@router.get("/api/features/{feature_id}/ai-draft", response_model=AiDraftOut)
async def get_feature_draft(
    feature_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> AiDraftOut:
    await require_feature_access(db, feature_id, user)
    return _out(await _load(db, user, feature_id=feature_id))


@router.put("/api/features/{feature_id}/ai-draft", response_model=AiDraftOut)
async def put_feature_draft(
    feature_id: uuid.UUID, body: AiDraftIn, user: CurrentUser, db: DbSession
) -> AiDraftOut:
    await require_feature_access(db, feature_id, user)
    return await _save(db, user, body, feature_id=feature_id)