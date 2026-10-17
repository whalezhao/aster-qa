"""AI 相关的只读/按需接口：执行评估查询、签名前预检、团队复盘。

原则：AI 只给建议，不阻断任何操作；项目没配模型时明确报「没配」，不静默降级。
"""

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from ..ai_review import (
    latest_check,
    save_check,
    save_review,
    task_precheck,
    team_review,
)
from ..deps import CurrentUser, DbSession, require_team_role
from ..models import AiCheck, RunBatch, TestTask
from ..schemas import AiCheckOut

router = APIRouter(tags=["ai"])


def _out(check: AiCheck | None) -> AiCheckOut:
    if check is None:
        return AiCheckOut(status="none")
    detail = check.detail or {}
    return AiCheckOut(
        status=check.status,
        verdict=check.verdict,
        summary=check.summary,
        reasons=list(detail.get("reasons") or []),
        advice=list(detail.get("advice") or []),
        diagnoses=list(detail.get("diagnoses") or []),
        markdown=detail.get("markdown"),
        model_name=check.model_name,
        error=check.error,
        created_at=check.created_at,
    )


@router.get("/api/batches/{batch_id}/ai-check", response_model=AiCheckOut)
async def get_batch_check(
    batch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> AiCheckOut:
    """批次最新一次的 AI 评估。pending 时前端轮询，done 后展示结论。"""
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "批次不存在")
    await require_team_role(batch.team_id, user, db, "member")
    return _out(await latest_check(db, "batch", batch_id))


@router.post("/api/batches/{batch_id}/ai-check", response_model=AiCheckOut)
async def rerun_batch_check(
    batch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> AiCheckOut:
    """重新评估一次（异步）。

    评估口径会演进 —— 早先只喂了计数，现在会读失败用例的真实执行记录。老批次想按新
    口径重看一遍，就靠这个入口；已经在排队中的不重复入队。
    """
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "批次不存在")
    await require_team_role(batch.team_id, user, db, "member")

    pending = (
        await db.execute(
            select(AiCheck.id).where(
                AiCheck.entity_type == "batch",
                AiCheck.entity_id == batch_id,
                AiCheck.status == "pending",
            )
        )
    ).first()
    if pending is None:
        db.add(AiCheck(entity_type="batch", entity_id=batch_id, status="pending"))
        await db.commit()
    return _out(await latest_check(db, "batch", batch_id))


@router.post("/api/tasks/{task_id}/ai/precheck", response_model=AiCheckOut)
async def run_task_precheck(
    task_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> AiCheckOut:
    """签名前的 AI 预检。同步调用模型（几十秒），结论只做参考。"""
    task = await db.get(TestTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    await require_team_role(task.team_id, user, db, "member")
    try:
        result, model_name = await task_precheck(db, task)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    check = await save_check(
        db, entity_type="task", entity_id=task_id, result=result, model_name=model_name
    )
    await db.commit()
    return _out(check)


@router.post("/api/teams/{team_id}/ai/review", response_model=AiCheckOut)
async def run_team_review(
    team_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    days: int = Query(default=7, ge=1, le=90),
) -> AiCheckOut:
    """按需生成团队复盘（Markdown）。同步调用模型。"""
    await require_team_role(team_id, user, db, "member")
    try:
        markdown, model_name = await team_review(db, team_id, days)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    check = await save_review(db, team_id=team_id, markdown=markdown, model_name=model_name)
    await db.commit()
    return _out(check)


@router.get("/api/teams/{team_id}/ai/review/latest", response_model=AiCheckOut)
async def get_latest_team_review(
    team_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> AiCheckOut:
    """最近一次团队复盘，打开统计页时先展示它，不用每次重新生成。"""
    await require_team_role(team_id, user, db, "member")
    return _out(await latest_check(db, "team", team_id))
