"""统计聚合。

全部走已落库的 SQL，不重读产物文件。

三个贯穿整个模块的口径决定：

1. **通过率一律「先求和再相除」**（SUM(passed)/SUM(total)），不是 AVG(单次通过率)。
   后者会让只有 1 个用例的 run 和 200 个用例的 run 权重相同，数字会骗人。

2. **AI 执行结果有随机性，所以每个通过率都必须带样本量 n，并给出 Wilson 置信下界。**
   下界用于回归门禁（n=1 时 100% 看起来完美，下界只有 ~0.21，这才是诚实的读法）。

3. **没有「冷跑/热跑」之分 —— 每次执行都是冷跑。** 因为每个 run 有自己的
   MIDSCENE_RUN_DIR，midscene 的 cache 目录也随之独立，缓存不可能跨 run 复用
   （实测 cache.log 每次都是 `no cache file found`）。这对统计是好事：数字里不含
   「第二次跑就变快变稳」的水分。代价是重跑不省 AI 成本。
   注意别拿 ai_calls.cached_input 当热跑信号 —— 那是**上游 prompt cache**（服务商缓存
   system prompt），冷跑也会有值。
"""

import math
import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import case, func, select

from ..deps import (
    CurrentUser,
    DbSession,
    require_project_access,
    require_team_role,
    visible_team_ids,
)
from ..models import AiCall, CaseResult, CaseStability, Feature, Project, Run, TestCase, TestTask

router = APIRouter(prefix="/api/stats", tags=["stats"])

Z_95 = 1.959964
FLAKY_WINDOW_DAYS = 14


def wilson_lower_bound(passed: int, total: int, z: float = Z_95) -> float | None:
    """Wilson score 区间下界。

    比直接用点估计诚实：n 很小时下界会显著低于通过率，避免「跑了 1 次全过」
    被读成「100% 稳定」。
    """
    if total <= 0:
        return None
    p = passed / total
    denominator = 1 + z * z / total
    centre = p + z * z / (2 * total)
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return max(0.0, (centre - margin) / denominator)


def _run_scope(
    *,
    team_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    iteration_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
    include_infra: bool = False,
):
    # 只看跑完的：queued/running 的还没结果，failed/cancelled/timed_out 的没有指标
    conditions = [Run.status.in_(("succeeded", "failed"))]
    if not include_infra:
        # 排除「非用例原因」的失败（模型额度用尽、服务不可达、网络不通）。
        # 它们会让整批用例记成 failed —— 算进通过率就是在报一个假数字。
        conditions.append(Run.failure_kind.is_(None))
    if team_id is not None:
        conditions.append(Run.team_id == team_id)
    if project_id is not None:
        conditions.append(Run.project_id == project_id)
    if iteration_id is not None:
        conditions.append(Run.iteration_id == iteration_id)
    if date_from is not None:
        conditions.append(Run.started_at >= datetime.combine(date_from, datetime.min.time(), UTC))
    if date_to is not None:
        conditions.append(
            Run.started_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), UTC)
        )
    return conditions


def _terminal_scope(
    *,
    team_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    iteration_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
):
    """所有已结束的 run（含失败/取消/非用例原因）—— 用于结果分布，不做通过率口径过滤。"""
    conditions = [Run.status.in_(("succeeded", "failed", "cancelled", "timed_out"))]
    if team_id is not None:
        conditions.append(Run.team_id == team_id)
    if project_id is not None:
        conditions.append(Run.project_id == project_id)
    if iteration_id is not None:
        conditions.append(Run.iteration_id == iteration_id)
    if date_from is not None:
        conditions.append(Run.started_at >= datetime.combine(date_from, datetime.min.time(), UTC))
    if date_to is not None:
        conditions.append(
            Run.started_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), UTC)
        )
    return conditions


async def _metrics(db: DbSession, conditions) -> dict:
    row = (
        await db.execute(
            select(
                func.count(Run.id),
                func.coalesce(func.sum(Run.total), 0),
                func.coalesce(func.sum(Run.passed), 0),
                func.coalesce(func.sum(Run.failed), 0),
                func.coalesce(func.sum(Run.passed_after_retry), 0),
                func.coalesce(func.avg(Run.duration_ms), 0),
                func.coalesce(
                    func.percentile_cont(0.5).within_group(Run.duration_ms.asc()), 0
                ),
            ).where(*conditions)
        )
    ).one()

    run_count, total, passed, failed, passed_after_retry, avg_ms, median_ms = row
    total, passed, failed, passed_after_retry = (
        int(total),
        int(passed),
        int(failed),
        int(passed_after_retry),
    )
    return {
        "runs": int(run_count),
        # n 是用例数不是 run 数 —— 通过率的分母是「跑了多少个用例」
        "sample_size": total,
        "total": total,
        "passed": passed,
        "failed": failed,
        "passed_after_retry": passed_after_retry,
        "final_pass_rate": (passed / total) if total else None,
        "first_pass_rate": ((passed - passed_after_retry) / total) if total else None,
        # 重试率单列：重试会掩盖不稳定，不能混进通过率里
        "retry_recovery_rate": (passed_after_retry / total) if total else None,
        "pass_rate_lower_bound": wilson_lower_bound(passed, total),
        "sample_sufficient": total >= 3,
        "avg_duration_ms": int(avg_ms or 0),
        "median_duration_ms": int(median_ms or 0),
    }


@router.get("/overview")
async def overview(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    iteration_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    await _authorize(db, user, team_id, project_id)
    conditions = _run_scope(
        team_id=team_id,
        project_id=project_id,
        iteration_id=iteration_id,
        date_from=date_from,
        date_to=date_to,
    )
    # 被排除掉的「非用例原因」失败也要报出来 —— 静默丢数据是另一种撒谎。
    # 用户需要知道「还有 N 次执行因为模型额度/网络问题没算进来」。
    # 注意不能用上面的 conditions：它已含 failure_kind IS NULL，再加 IS NOT NULL 会自相矛盾。
    excluded_infra = (
        await db.execute(
            select(func.count(Run.id)).where(
                *_run_scope(
                    team_id=team_id,
                    project_id=project_id,
                    iteration_id=iteration_id,
                    date_from=date_from,
                    date_to=date_to,
                    include_infra=True,
                ),
                Run.failure_kind.is_not(None),
            )
        )
    ).scalar_one()

    metrics = await _metrics(db, conditions)

    cost = (
        await db.execute(
            select(
                func.count(AiCall.id),
                func.coalesce(func.sum(AiCall.total_tokens), 0),
                func.coalesce(func.sum(AiCall.cost_ms), 0),
                # 上游 prompt cache 命中的 token 数。注意这不是「热跑」信号，
                # 冷跑也会有值（服务商缓存 system prompt）
                func.coalesce(func.sum(AiCall.cached_input), 0),
            )
            .join(Run, Run.id == AiCall.run_id)
            .where(*conditions)
        )
    ).one()

    # 环比：只在给了明确日期区间时算（默认「全部时间」没有可比的上一段）
    compare = None
    if date_from is not None and date_to is not None:
        span = date_to - date_from + timedelta(days=1)
        previous_from = date_from - span
        previous_to = date_from - timedelta(days=1)
        compare = await _metrics(
            db,
            _run_scope(
                team_id=team_id,
                project_id=project_id,
                iteration_id=iteration_id,
                date_from=previous_from,
                date_to=previous_to,
            ),
        )
        compare["date_from"] = previous_from.isoformat()
        compare["date_to"] = previous_to.isoformat()

    return {
        "scope": {
            "team_id": str(team_id) if team_id else None,
            "project_id": str(project_id) if project_id else None,
            "iteration_id": str(iteration_id) if iteration_id else None,
        },
        **metrics,
        "ai_calls": int(cost[0]),
        "ai_total_tokens": int(cost[1]),
        "ai_cost_ms": int(cost[2]),
        "ai_prompt_cache_tokens": int(cost[3]),
        # 因模型额度/服务/网络问题被排除在通过率之外的执行次数
        "excluded_infra_runs": int(excluded_infra),
        "compare": compare,
    }


@router.get("/breakdown")
async def breakdown(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    iteration_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """结果分布 / 失败原因 / 失败集中度 / 耗时分布。

    和 overview 的口径不同：这里要的是「所有结束了的执行都去哪了」，
    所以不过滤失败原因，也不看通过率。
    """
    await _authorize(db, user, team_id, project_id)
    conditions = _terminal_scope(
        team_id=team_id,
        project_id=project_id,
        iteration_id=iteration_id,
        date_from=date_from,
        date_to=date_to,
    )

    labels = {
        "all_passed": "全部通过",
        "with_failures": "含失败",
        "exec_failed": "执行失败",
        "excluded": "非用例原因",
        "interrupted": "取消/超时",
    }
    buckets = {
        key: {"key": key, "label": label, "runs": 0, "cases": 0, "failed_cases": 0}
        for key, label in labels.items()
    }

    bucket_expr = case(
        (
            Run.status == "succeeded",
            case((Run.failed == 0, "all_passed"), else_="with_failures"),
        ),
        (Run.status.in_(("cancelled", "timed_out")), "interrupted"),
        (Run.failure_kind.is_not(None), "excluded"),
        else_="exec_failed",
    )
    rows = (
        await db.execute(
            select(
                bucket_expr.label("bucket"),
                func.count(Run.id),
                func.coalesce(func.sum(Run.total), 0),
                func.coalesce(func.sum(Run.failed), 0),
            )
            .where(*conditions)
            .group_by(bucket_expr)
        )
    ).all()

    for key, runs, total, failed in rows:
        if key not in buckets:
            continue
        buckets[key]["runs"] += int(runs)
        buckets[key]["cases"] += int(total)
        buckets[key]["failed_cases"] += int(failed)

    # 失败原因单独按 failure_kind 统计（和上面的分类是同一批 run 的两个切面）
    kind_rows = (
        await db.execute(
            select(Run.failure_kind, func.count(Run.id))
            .where(*conditions, Run.failure_kind.is_not(None))
            .group_by(Run.failure_kind)
        )
    ).all()
    kind_labels = {"ai_quota": "模型额度", "ai_service": "模型服务", "network": "网络"}
    failure_kinds = [
        {"kind": kind, "label": kind_labels.get(kind, kind), "runs": int(runs)}
        for kind, runs in sorted(kind_rows, key=lambda item: item[1], reverse=True)
    ]

    top_features = (
        await db.execute(
            select(Feature.id, Feature.name, Project.name, func.count(CaseResult.id))
            .join(Run, Run.id == CaseResult.run_id)
            .join(TestCase, TestCase.id == CaseResult.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .join(Project, Project.id == Feature.project_id)
            .where(*conditions, CaseResult.status == "failed")
            .group_by(Feature.id, Feature.name, Project.name)
            .order_by(func.count(CaseResult.id).desc())
            .limit(8)
        )
    ).all()

    duration_expr = case(
        (Run.duration_ms.is_(None), "unknown"),
        (Run.duration_ms < 30_000, "0-30s"),
        (Run.duration_ms < 60_000, "30-60s"),
        (Run.duration_ms < 120_000, "1-2m"),
        (Run.duration_ms < 300_000, "2-5m"),
        else_="5m+",
    )
    duration_rows = dict(
        (
            await db.execute(
                select(duration_expr, func.count(Run.id))
                .where(*conditions)
                .group_by(duration_expr)
            )
        ).all()
    )
    duration_order = ["0-30s", "30-60s", "1-2m", "2-5m", "5m+", "unknown"]
    duration_labels = {"unknown": "未知"}
    duration_buckets = [
        {
            "bucket": key,
            "label": duration_labels.get(key, key),
            "runs": int(duration_rows.get(key, 0)),
        }
        for key in duration_order
        if duration_rows.get(key)
    ]

    return {
        "status_breakdown": list(buckets.values()),
        "failure_kinds": failure_kinds,
        "top_failing_features": [
            {
                "feature_id": str(fid),
                "feature_name": fname,
                "project_name": pname,
                "failures": int(count),
            }
            for fid, fname, pname, count in top_features
        ],
        "duration_buckets": duration_buckets,
    }


@router.get("/trend")
async def trend(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    iteration_id: uuid.UUID | None = None,
    bucket: str = Query(default="day", pattern="^(day|iteration)$"),
    days: int = Query(default=30, le=365),
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    await _authorize(db, user, team_id, project_id)
    # 按迭代分组时不受 days 限制：迭代的跨度本来就比 30 天长
    effective_from = date_from
    if effective_from is None and bucket != "iteration":
        effective_from = datetime.now(UTC).date() - timedelta(days=days)
    conditions = _run_scope(
        team_id=team_id,
        project_id=project_id,
        iteration_id=iteration_id,
        date_from=effective_from,
        date_to=date_to,
    )

    # 按迭代分组时不受 days 限制：迭代的跨度本来就比 30 天长
    group_expr = (
        Run.iteration_id
        if bucket == "iteration"
        else func.date_trunc("day", Run.started_at)
    )
    rows = (
        await db.execute(
            select(
                group_expr.label("bucket"),
                func.count(Run.id),
                func.coalesce(func.sum(Run.total), 0),
                func.coalesce(func.sum(Run.passed), 0),
                func.coalesce(func.sum(Run.failed), 0),
            )
            .where(*conditions)
            .group_by(group_expr)
            .order_by(group_expr)
        )
    ).all()

    points = []
    for bucket_value, run_count, total, passed, failed in rows:
        total, passed = int(total), int(passed)
        points.append(
            {
                "bucket": bucket_value.isoformat() if hasattr(bucket_value, "isoformat") else str(bucket_value) if bucket_value else None,
                "runs": int(run_count),
                "total": total,
                "passed": passed,
                "failed": int(failed),
                "pass_rate": (passed / total) if total else None,
                "pass_rate_lower_bound": wilson_lower_bound(passed, total),
            }
        )
    return points


@router.get("/failures")
async def failures(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    iteration_id: uuid.UUID | None = None,
    days: int = Query(default=30, le=365),
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=20, le=100),
) -> list[dict]:
    await _authorize(db, user, team_id, project_id)
    conditions = _run_scope(
        team_id=team_id,
        project_id=project_id,
        iteration_id=iteration_id,
        date_from=date_from or (datetime.now(UTC).date() - timedelta(days=days)),
        date_to=date_to,
    )
    rows = (
        await db.execute(
            select(
                TestCase.id,
                TestCase.name,
                Feature.name,
                func.count(CaseResult.id).label("failures"),
            )
            .join(Run, Run.id == CaseResult.run_id)
            .join(TestCase, TestCase.id == CaseResult.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(*conditions, CaseResult.status == "failed")
            .group_by(TestCase.id, TestCase.name, Feature.name)
            .order_by(func.count(CaseResult.id).desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "test_case_id": str(cid),
            "case_name": name,
            "feature_name": feature_name,
            "failures": int(count),
        }
        for cid, name, feature_name, count in rows
    ]


@router.get("/flaky")
async def flaky(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    limit: int = Query(default=50, le=200),
) -> list[dict]:
    """不稳定用例榜单。

    这是这套系统对 AI 执行器随机性的核心应对：同一个用例时过时不过，必须被显式看见，
    而不是被平均进一个通过率里当没事发生。
    """
    if project_id is not None:
        await require_project_access(db, project_id, user)
        team_filter = [Project.id == project_id]
    elif team_id is not None:
        await require_team_role(team_id, user, db, "member")
        team_filter = [Project.team_id == team_id]
    else:
        ids = await visible_team_ids(db, user)
        if not ids:
            return []
        team_filter = [Project.team_id.in_(ids)]

    window_start = datetime.now(UTC) - timedelta(days=FLAKY_WINDOW_DAYS)
    rows = (
        await db.execute(
            select(
                TestCase.id,
                TestCase.name,
                Feature.name,
                CaseStability.runs_count,
                CaseStability.passed_count,
                CaseStability.failed_count,
                CaseStability.last_status,
                CaseStability.last_run_at,
            )
            .join(TestCase, TestCase.id == CaseStability.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .join(Project, Project.id == Feature.project_id)
            .where(
                *team_filter,
                CaseStability.flaky.is_(True),
                CaseStability.last_run_at >= window_start,
            )
            .order_by(CaseStability.failed_count.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "test_case_id": str(cid),
            "case_name": name,
            "feature_name": feature_name,
            "runs": int(runs),
            "passed": int(passed),
            "failed": int(failed),
            "flakiness": (int(failed) / int(runs)) if runs else None,
            "last_status": last_status,
            "last_run_at": last_run_at.isoformat() if last_run_at else None,
        }
        for cid, name, feature_name, runs, passed, failed, last_status, last_run_at in rows
    ]


@router.get("/cost")
async def cost(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    days: int = Query(default=30, le=365),
) -> dict:
    await _authorize(db, user, team_id, project_id)
    conditions = _run_scope(
        team_id=team_id,
        project_id=project_id,
        iteration_id=None,
        date_from=datetime.now(UTC).date() - timedelta(days=days),
        date_to=None,
    )
    # 表达式必须复用同一个对象：每次新建 func.date_trunc(...) 会生成不同的绑定参数，
    # PostgreSQL 就认不出 GROUP BY 与 SELECT 是同一个表达式，直接报 GroupingError
    day_expr = func.date_trunc("day", Run.started_at).label("day")
    by_day = (
        await db.execute(
            select(
                day_expr,
                func.coalesce(func.sum(AiCall.total_tokens), 0),
                func.coalesce(func.sum(AiCall.cost_ms), 0),
                func.count(AiCall.id),
            )
            .join(AiCall, AiCall.run_id == Run.id)
            .where(*conditions)
            .group_by(day_expr)
            .order_by(day_expr)
        )
    ).all()

    by_model = (
        await db.execute(
            select(
                Run.model_name,
                # distinct：join 上 ai_calls 后每个 run 会有多行，直接 count(Run.id) 数的是调用数
                func.count(func.distinct(Run.id)),
                func.coalesce(func.sum(AiCall.total_tokens), 0),
                func.coalesce(func.sum(AiCall.cost_ms), 0),
            )
            .join(AiCall, AiCall.run_id == Run.id)
            .where(*conditions)
            .group_by(Run.model_name)
            .order_by(func.coalesce(func.sum(AiCall.total_tokens), 0).desc())
        )
    ).all()

    return {
        "by_day": [
            {
                "day": day.isoformat() if day else None,
                "total_tokens": int(tokens),
                "cost_ms": int(cost_ms),
                "ai_calls": int(calls),
            }
            for day, tokens, cost_ms, calls in by_day
        ],
        "by_model": [
            {
                "model": model,
                "runs": int(runs),
                "total_tokens": int(tokens),
                "cost_ms": int(cost_ms),
            }
            for model, runs, tokens, cost_ms in by_model
        ],
    }


@router.get("/regression")
async def regression(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    iteration_id: uuid.UUID | None = None,
) -> list[dict]:
    """回归计划进度：每个回归任务覆盖了多少功能、跑了多少用例、通过率多少。"""
    if team_id is not None:
        await require_team_role(team_id, user, db, "member")
        team_filter = [TestTask.team_id == team_id]
    else:
        ids = await visible_team_ids(db, user)
        if not ids:
            return []
        team_filter = [TestTask.team_id.in_(ids)]

    conditions = [*team_filter, TestTask.type == "feature_regression"]
    if iteration_id is not None:
        conditions.append(TestTask.iteration_id == iteration_id)

    rows = (
        await db.execute(
            select(
                TestTask.id,
                TestTask.name,
                TestTask.status,
                TestTask.iteration_id,
                func.count(Run.id),
                func.coalesce(func.sum(Run.total), 0),
                func.coalesce(func.sum(Run.passed), 0),
                func.coalesce(func.sum(Run.failed), 0),
            )
            .outerjoin(Run, Run.task_id == TestTask.id)
            .where(*conditions)
            .group_by(TestTask.id, TestTask.name, TestTask.status, TestTask.iteration_id)
            .order_by(TestTask.created_at.desc())
            .limit(100)
        )
    ).all()

    task_ids = [row[0] for row in rows]
    coverage = await _feature_coverage(db, task_ids)

    out = []
    for task_id, name, task_status, task_iteration, run_count, total, passed, failed in rows:
        total, passed = int(total), int(passed)
        out.append(
            {
                "task_id": str(task_id),
                "name": name,
                "status": task_status,
                "iteration_id": str(task_iteration) if task_iteration else None,
                "runs": int(run_count),
                "features": coverage.get(task_id, 0),
                "total": total,
                "passed": passed,
                "failed": int(failed),
                "pass_rate": (passed / total) if total else None,
                "pass_rate_lower_bound": wilson_lower_bound(passed, total),
            }
        )
    return out


async def _feature_coverage(db: DbSession, task_ids: list[uuid.UUID]) -> dict:
    if not task_ids:
        return {}
    from ..models import TaskFeature

    rows = (
        await db.execute(
            select(TaskFeature.task_id, func.count(TaskFeature.feature_id))
            .where(TaskFeature.task_id.in_(task_ids))
            .group_by(TaskFeature.task_id)
        )
    ).all()
    return {task_id: int(count) for task_id, count in rows}


async def _authorize(
    db: DbSession, user: CurrentUser, team_id: uuid.UUID | None, project_id: uuid.UUID | None
) -> None:
    if project_id is not None:
        await require_project_access(db, project_id, user)
    elif team_id is not None:
        await require_team_role(team_id, user, db, "member")
    else:
        if not await visible_team_ids(db, user):
            raise HTTPException(403, "没有可访问的团队")
