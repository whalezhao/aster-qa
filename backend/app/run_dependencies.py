"""编排 run 的依赖门禁与阻塞传播。

认领门禁在 worker 的 claim 查询里（只挑前置都成功过的 run）；这里负责把「前置已经
失败/取消/阻塞」的后继直接落成 blocked，避免它们一直排队。所有状态变更都带
`WHERE status='queued'`，重复/并发调用是幂等的。
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from .models import CaseResult, Run, RunDependency, TestCase
from .orchestration import (
    TERMINAL_RUN_STATUSES,
    blocked_reason,
    condition_reason,
    evaluate_condition,
    node_succeeded,
    skip_reason,
)
from .taskstatus import refresh_task_status

# 和 worker 的认领锁分开：认领查询本身已经排除「前置未成功」的 run，
# 这里只需要把自己的状态更新串行化。
DEPENDENCY_LOCK_KEY = 0x4153544552


async def _lock(db: AsyncSession) -> None:
    await db.execute(select(func.pg_advisory_xact_lock(DEPENDENCY_LOCK_KEY)))


async def _case_name(db: AsyncSession, run: Run) -> str | None:
    if not run.case_ids or len(run.case_ids) != 1:
        return None
    try:
        case_id = uuid.UUID(str(run.case_ids[0]))
    except (TypeError, ValueError):
        return None
    case = await db.get(TestCase, case_id)
    return case.name if case is not None else None


async def _predecessors(db: AsyncSession, run_id: uuid.UUID) -> list[Run]:
    return list(
        (
            await db.execute(
                select(Run)
                .join(RunDependency, RunDependency.depends_on_run_id == Run.id)
                .where(RunDependency.run_id == run_id)
            )
        ).scalars()
    )


async def _dependents(db: AsyncSession, run_id: uuid.UUID) -> list[Run]:
    return list(
        (
            await db.execute(
                select(Run)
                .join(RunDependency, RunDependency.run_id == Run.id)
                .where(
                    RunDependency.depends_on_run_id == run_id,
                    Run.status == "queued",
                )
            )
        ).scalars()
    )


def _version_parts(run: Run) -> tuple[uuid.UUID | None, int | None]:
    if not run.case_ids:
        return None, None
    raw = (run.case_versions or {}).get(str(run.case_ids[0]))
    if not isinstance(raw, dict):
        return None, None
    try:
        version_id = uuid.UUID(str(raw.get("version_id")))
    except (TypeError, ValueError):
        version_id = None
    try:
        version_no = int(raw.get("version_no"))
    except (TypeError, ValueError):
        version_no = None
    return version_id, version_no


async def _block(db: AsyncSession, dependent: Run, predecessor: Run) -> bool:
    """把 dependent 落成 blocked；返回是否由本次调用完成状态转换。"""
    name = await _case_name(db, predecessor) or "前置用例"
    reason = blocked_reason(name, predecessor.status)
    now = datetime.now(UTC)
    result = await db.execute(
        update(Run)
        .where(Run.id == dependent.id, Run.status == "queued")
        .values(
            status="blocked",
            started_at=now,
            ended_at=now,
            duration_ms=0,
            total=1,
            passed=0,
            failed=1,
            not_run=0,
            final_pass_rate=0,
            first_pass_rate=0,
            error_message=reason,
        )
    )
    if result.rowcount == 0:
        return False

    case_id: uuid.UUID | None = None
    if dependent.case_ids:
        try:
            case_id = uuid.UUID(str(dependent.case_ids[0]))
        except (TypeError, ValueError):
            case_id = None
    case = await db.get(TestCase, case_id) if case_id is not None else None
    version_id, version_no = _version_parts(dependent)
    db.add(
        CaseResult(
            run_id=dependent.id,
            test_case_id=case_id,
            test_case_version_id=version_id,
            test_case_version_no=version_no,
            midscene_document_id=f"blocked:{case_id or dependent.id}",
            midscene_case_id=f"blocked:{case_id or dependent.id}",
            source_path=f"{case_id}.yaml" if case_id is not None else None,
            case_index=0,
            name=case.name if case is not None else None,
            status="blocked",
            blocked_reason=reason,
            attempt_count=1,
        )
    )
    await db.flush()
    return True


async def _skip(db: AsyncSession, dependent: Run, reason: str) -> bool:
    """条件不满足/前置未执行导致的分支跳过；不计失败。"""
    now = datetime.now(UTC)
    result = await db.execute(
        update(Run)
        .where(Run.id == dependent.id, Run.status == "queued")
        .values(
            status="skipped",
            started_at=now,
            ended_at=now,
            duration_ms=0,
            total=0,
            passed=0,
            failed=0,
            not_run=1,
            final_pass_rate=0,
            first_pass_rate=0,
            error_message=reason,
            condition_passed=False,
            flow_inputs_ready=True,
        )
    )
    if result.rowcount == 0:
        return False

    case_id: uuid.UUID | None = None
    if dependent.case_ids:
        try:
            case_id = uuid.UUID(str(dependent.case_ids[0]))
        except (TypeError, ValueError):
            case_id = None
    case = await db.get(TestCase, case_id) if case_id is not None else None
    version_id, version_no = _version_parts(dependent)
    db.add(
        CaseResult(
            run_id=dependent.id,
            test_case_id=case_id,
            test_case_version_id=version_id,
            test_case_version_no=version_no,
            midscene_document_id=f"skipped:{case_id or dependent.id}",
            midscene_case_id=f"skipped:{case_id or dependent.id}",
            source_path=f"{case_id}.yaml" if case_id is not None else None,
            case_index=0,
            name=case.name if case is not None else None,
            status="skipped",
            blocked_reason=reason,
            attempt_count=1,
        )
    )
    await db.flush()
    return True


async def _advance_dependent(
    db: AsyncSession, dependent: Run
) -> tuple[str, Run]:
    """推进一个排队中的后继；返回 blocked/skipped/ready/wait。"""
    predecessors = await _predecessors(db, dependent.id)
    merged = dict(dependent.flow_inputs or {})
    for predecessor in predecessors:
        if predecessor.status == "succeeded" and predecessor.flow_outputs:
            merged.update(predecessor.flow_outputs)
    if merged != (dependent.flow_inputs or {}):
        dependent.flow_inputs = merged

    skipped = next(
        (item for item in predecessors if item.status == "skipped"), None
    )
    if skipped is not None:
        name = await _case_name(db, skipped) or "前置用例"
        if await _skip(db, dependent, skip_reason(name)):
            return "skipped", dependent
        return "wait", dependent

    bad = next(
        (
            item
            for item in predecessors
            if item.status in TERMINAL_RUN_STATUSES and not node_succeeded(item)
        ),
        None,
    )
    if bad is not None:
        if await _block(db, dependent, bad):
            return "blocked", dependent
        return "wait", dependent

    if any(item.status not in TERMINAL_RUN_STATUSES for item in predecessors):
        await db.flush()
        return "wait", dependent

    # 前置都成功：合并输出、允许认领，并求值条件
    dependent.flow_inputs_ready = True
    if dependent.condition and dependent.condition_passed is not True:
        if not evaluate_condition(dependent.condition, dependent.flow_inputs):
            if await _skip(
                db,
                dependent,
                condition_reason(dependent.condition, dependent.flow_inputs),
            ):
                return "skipped", dependent
            return "wait", dependent
        dependent.condition_passed = True
    await db.flush()
    return "ready", dependent


async def ensure_flow_result(db: AsyncSession, run: Run) -> None:
    """flow run 在产出结果前就失败/超时/取消时，补一条结果，报告里才有这一行。"""
    if run.run_kind != "flow" or not run.case_ids:
        return
    existing = (
        await db.execute(
            select(CaseResult.id).where(CaseResult.run_id == run.id).limit(1)
        )
    ).first()
    if existing is not None:
        return
    try:
        case_id = uuid.UUID(str(run.case_ids[0]))
    except (TypeError, ValueError):
        case_id = None
    case = await db.get(TestCase, case_id) if case_id is not None else None
    version_id, version_no = _version_parts(run)
    status = (
        run.status
        if run.status in {"failed", "timed_out", "cancelled"}
        else "failed"
    )
    db.add(
        CaseResult(
            run_id=run.id,
            test_case_id=case_id,
            test_case_version_id=version_id,
            test_case_version_no=version_no,
            midscene_document_id=f"flow:{case_id or run.id}",
            midscene_case_id=f"flow:{case_id or run.id}",
            source_path=f"{case_id}.yaml" if case_id is not None else None,
            case_index=0,
            name=case.name if case is not None else None,
            status=status,
            attempt_count=1,
        )
    )
    await db.flush()


async def resolve_run_dependents(db: AsyncSession, run: Run) -> list[Run]:
    """run 进入终态后调用：推进它的后继（合并输出、阻塞、跳过或放行）。"""
    if run.status not in TERMINAL_RUN_STATUSES:
        return []
    await _lock(db)

    changed: list[Run] = []
    queue = [run]
    visited: set[uuid.UUID] = set()
    while queue:
        current = queue.pop(0)
        if current.id in visited:
            continue
        visited.add(current.id)
        for dependent in await _dependents(db, current.id):
            action, item = await _advance_dependent(db, dependent)
            if action in {"blocked", "skipped"}:
                changed.append(item)
                queue.append(item)

    if changed:
        await refresh_task_status(db, run.task_id)
    await db.flush()
    return changed


async def sweep_blocked_dependents(db: AsyncSession) -> list[Run]:
    """安全网：推进所有前置已终态的 queued run（阻塞/跳过/放行）。"""
    predecessor = aliased(Run)
    queued = list(
        (
            await db.execute(
                select(Run)
                .join(RunDependency, RunDependency.run_id == Run.id)
                .join(predecessor, predecessor.id == RunDependency.depends_on_run_id)
                .where(
                    Run.status == "queued",
                    predecessor.status.in_(TERMINAL_RUN_STATUSES),
                )
            )
        ).scalars()
    )
    changed: list[Run] = []
    touched_tasks: set[uuid.UUID | None] = set()
    seen: set[uuid.UUID] = set()
    for dependent in queued:
        if dependent.id in seen:
            continue
        seen.add(dependent.id)
        action, item = await _advance_dependent(db, dependent)
        if action in {"blocked", "skipped"}:
            changed.append(item)
            touched_tasks.add(item.task_id)
            changed.extend(await resolve_run_dependents(db, item))
    for task_id in touched_tasks:
        if task_id is not None:
            await refresh_task_status(db, task_id)
    await db.flush()
    return changed