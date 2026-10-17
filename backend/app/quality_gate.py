"""CI 质量门禁。

只对「有效 run」计算：`failure_kind` 不为空的 run 是模型/网络/额度问题，
把它们算成产品失败会让门禁误报。"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import CaseResult, Run, RunBatch, TestCase, TestTask
from .taskstatus import ACTIVE_RUN_STATUSES

SUCCESS_STATUSES = {"success", "passed"}


def gate_result(
    *,
    enabled: bool,
    min_pass_rate: float | None,
    fail_on_p0: bool,
    batch_active: bool,
    runs: list[dict],
    failed_p0: int,
) -> dict:
    excluded_runs = sum(1 for r in runs if r.get("failure_kind"))
    eligible = [
        r
        for r in runs
        if r.get("status") in {"succeeded", "failed"} and not r.get("failure_kind")
    ]
    total = sum(int(r.get("total") or 0) for r in eligible)
    passed = sum(int(r.get("passed") or 0) for r in eligible)
    failed = sum(int(r.get("failed") or 0) for r in eligible)
    not_run = sum(int(r.get("not_run") or 0) for r in eligible)
    execution_failures = sum(1 for r in eligible if r.get("status") == "failed")
    pass_rate = (passed / total) if total else None

    detail = {
        "enabled": enabled,
        "min_pass_rate": min_pass_rate,
        "fail_on_p0": fail_on_p0,
        "total": total,
        "passed_cases": passed,
        "failed_cases": failed,
        "not_run": not_run,
        "failed_p0": failed_p0,
        "execution_failures": execution_failures,
        "excluded_runs": excluded_runs,
        "pass_rate": pass_rate,
    }

    if not enabled:
        return {**detail, "status": "disabled", "passed": True, "reasons": []}
    if batch_active:
        return {**detail, "status": "pending", "passed": False, "reasons": ["批次尚未结束"]}
    if not eligible:
        return {
            **detail,
            "status": "no_data",
            "passed": False,
            "reasons": ["没有有效执行（可能全部被模型/网络问题排除）"],
        }
    if total == 0:
        return {
            **detail,
            "status": "no_data",
            "passed": False,
            "reasons": ["有效执行里没有用例结果"],
        }

    reasons: list[str] = []
    if execution_failures:
        reasons.append(f"{execution_failures} 个 run 执行失败")
    if min_pass_rate is not None and pass_rate is not None and pass_rate < min_pass_rate:
        reasons.append(f"通过率 {pass_rate:.1%} 低于要求 {min_pass_rate:.1%}")
    if fail_on_p0 and failed_p0:
        reasons.append(f"{failed_p0} 个 P0 用例失败")
    status = "failed" if reasons else "passed"
    return {**detail, "status": status, "passed": not reasons, "reasons": reasons}


async def evaluate_gate(db: AsyncSession, batch: RunBatch, task: TestTask | None) -> dict:
    runs = list(
        (
            await db.execute(
                select(
                    Run.status,
                    Run.failure_kind,
                    Run.total,
                    Run.passed,
                    Run.failed,
                    Run.not_run,
                    Run.id,
                ).where(Run.batch_id == batch.id)
            )
        ).all()
    )
    run_dicts = [
        {
            "id": row.id,
            "status": row.status,
            "failure_kind": row.failure_kind,
            "total": row.total,
            "passed": row.passed,
            "failed": row.failed,
            "not_run": row.not_run,
        }
        for row in runs
    ]
    active = any(row.status in ACTIVE_RUN_STATUSES for row in runs)
    eligible_ids = [
        row.id
        for row in runs
        if row.status in {"succeeded", "failed"} and not row.failure_kind
    ]

    failed_p0 = 0
    if eligible_ids and task is not None and task.gate_fail_on_p0:
        failed_p0 = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(CaseResult)
                    .join(TestCase, TestCase.id == CaseResult.test_case_id)
                    .where(
                        CaseResult.run_id.in_(eligible_ids),
                        CaseResult.status.not_in(SUCCESS_STATUSES),
                        TestCase.priority == "P0",
                    )
                )
            ).scalar()
            or 0
        )

    return gate_result(
        enabled=bool(task and task.gate_enabled),
        min_pass_rate=(
            float(task.gate_min_pass_rate)
            if task and task.gate_min_pass_rate is not None
            else None
        ),
        fail_on_p0=bool(task and task.gate_fail_on_p0),
        batch_active=active,
        runs=run_dicts,
        failed_p0=failed_p0,
    )
