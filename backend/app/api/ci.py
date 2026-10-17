"""CI 触发与门禁查询。认证用团队 API Token，不走 JWT。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, select

from ..ci_tokens import CIContext, authenticate, require_scope
from ..deps import DbSession
from ..models import RunBatch, TaskCase, TestCase, TestTask
from ..quality_gate import evaluate_gate
from ..schemas import CiBatchOut, CiRunOut, GateOut, PreflightOut
from .batches import _run_aggregates, derive_status
from .task_common import active_task_ids, spawn_runs

router = APIRouter(tags=["ci"])


async def ci_context(
    db: DbSession,
    x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    authorization: str | None = Header(default=None),
) -> CIContext:
    token = x_api_token or ""
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    return await authenticate(db, token)


CiCtx = Annotated[CIContext, Depends(ci_context)]


@router.post("/api/ci/tasks/{task_id}/run", response_model=CiRunOut)
async def ci_run(
    task_id: uuid.UUID,
    ctx: CiCtx,
    db: DbSession,
) -> CiRunOut:
    require_scope(ctx, "run")
    task = await db.get(TestTask, task_id)
    if task is None or task.team_id != ctx.team_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    if await active_task_ids(db, [task.id]):
        raise HTTPException(status.HTTP_409_CONFLICT, "任务正在执行，请稍后重试")
    batch, runs = await spawn_runs(
        db,
        task,
        None,
        trigger="ci",
        created_by_id=task.created_by,
        created_by_token_id=ctx.token_id,
    )
    await db.commit()
    gate = await evaluate_gate(db, batch, task)
    case_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(TaskCase)
                .join(TestCase, TestCase.id == TaskCase.case_id)
                .where(TaskCase.task_id == task.id, TestCase.is_active.is_(True))
            )
        ).scalar()
        or 0
    )
    return CiRunOut(
        batch_id=batch.id,
        run_ids=[run.id for run in runs],
        case_count=case_count,
        gate=GateOut(**gate),
    )


@router.post("/api/ci/tasks/{task_id}/preflight", response_model=PreflightOut)
async def ci_preflight(
    task_id: uuid.UUID,
    ctx: CiCtx,
    db: DbSession,
) -> dict:
    require_scope(ctx, "read")
    task = await db.get(TestTask, task_id)
    if task is None or task.team_id != ctx.team_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    from ..preflight import run_preflight

    return await run_preflight(db, task)


@router.get("/api/ci/batches/{batch_id}", response_model=CiBatchOut)
async def ci_batch(
    batch_id: uuid.UUID,
    ctx: CiCtx,
    db: DbSession,
) -> CiBatchOut:
    require_scope(ctx, "read")
    batch = await db.get(RunBatch, batch_id)
    if batch is None or batch.team_id != ctx.team_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "批次不存在")
    aggregate = (await _run_aggregates(db, [batch.id])).get(batch.id)
    if aggregate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "批次下没有执行记录")
    real_failed = aggregate["failed"] - aggregate["excluded_failed"]
    batch_status = derive_status(
        aggregate["statuses"], real_failed, aggregate["excluded_runs"]
    )
    task = await db.get(TestTask, batch.task_id) if batch.task_id else None
    gate = batch.gate_detail or await evaluate_gate(db, batch, task)
    return CiBatchOut(
        id=batch.id,
        status=batch_status,
        running=batch_status == "running",
        total=aggregate["total"],
        passed=aggregate["passed"],
        failed=real_failed,
        excluded_runs=aggregate["excluded_runs"],
        environment_name=batch.environment_name,
        gate=GateOut(**gate),
    )
