"""执行批次 —— 用户视角的「一次执行」。

一次执行可能跨多个项目，技术上是多个 midscene 进程（run），但用户看到的是「我点了一次」。
这一层把两者对上：执行记录按批次展示，每行带各功能的通过情况，点进去再下钻到
各项目的 run → 用例结果 → midscene 报告（叶子节点）。
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select, update

from ..deps import (
    CurrentUser,
    DbSession,
    get_team_membership,
    require_team_role,
    visible_team_ids,
)
from ..models import (
    AiCheck,
    BatchReportSignoff,
    CaseResult,
    Feature,
    Project,
    Run,
    RunBatch,
    TaskCase,
    TaskFeature,
    Team,
    TestCase,
    TestTask,
    User,
)
from ..schemas import (
    BatchDetailOut,
    BatchListOut,
    BatchSignoffInfo,
    BatchSignoffOut,
    SignoffIn,
)
from .runs import _resolve_data_path

router = APIRouter(prefix="/api/batches", tags=["batches"])

ACTIVE_RUN_STATUSES = ("queued", "preparing", "running", "parsing")


def derive_status(statuses: list[str], real_failed: int, excluded_runs: int) -> str:
    """批次状态由它的 runs 现算，不落库 —— 存一份就多一处会不一致的地方。

    刻意区分 completed 与 completed_with_failures：执行跑完了和用例通过是两件事，
    混成一个「完成」会让列表上的颜色失去意义。

    real_failed 已经扣掉了「非用例原因」（模型额度/配置/网络）导致的失败 ——
    上游 429 把一整批用例记成 failed 时，显示「含 N 失败」会让人去追不存在的 bug。
    """
    if not statuses:
        return "empty"
    if any(s in ACTIVE_RUN_STATUSES for s in statuses):
        return "running"
    if all(s == "cancelled" for s in statuses):
        return "cancelled"

    succeeded = sum(1 for s in statuses if s == "succeeded")
    if succeeded == 0:
        # 一次都没跑成。全是非用例原因的话明确标出来，别伪装成执行失败
        return "excluded" if excluded_runs == len(statuses) else "failed"
    if succeeded < len(statuses):
        return "partial"
    return "completed_with_failures" if real_failed else "completed"


def _scope(
    *,
    team_ids: list[uuid.UUID],
    project_id: uuid.UUID | None,
    task_id: uuid.UUID | None,
    iteration_id: uuid.UUID | None,
    stage: str | None,
    name: str | None,
) -> list:
    conditions = [RunBatch.team_id.in_(team_ids)]
    if task_id is not None:
        conditions.append(RunBatch.task_id == task_id)
    if iteration_id is not None:
        conditions.append(RunBatch.iteration_id == iteration_id)
    if name:
        conditions.append(RunBatch.name.ilike(f"%{name}%"))
    if project_id is not None:
        conditions.append(
            select(Run.id)
            .where(Run.batch_id == RunBatch.id, Run.project_id == project_id)
            .exists()
        )
    if stage:
        # 批次里只要有该分期的功能就算命中
        conditions.append(
            select(CaseResult.id)
            .join(Run, Run.id == CaseResult.run_id)
            .join(TestCase, TestCase.id == CaseResult.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(Run.batch_id == RunBatch.id, TestCase.stage_override == stage)
            .exists()
            | select(CaseResult.id)
            .join(Run, Run.id == CaseResult.run_id)
            .join(TestCase, TestCase.id == CaseResult.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(
                Run.batch_id == RunBatch.id,
                TestCase.stage_override.is_(None),
                Feature.stage == stage,
            )
            .exists()
        )
    return conditions


async def _run_aggregates(db, batch_ids: list[uuid.UUID]) -> dict:
    """按批次聚合 runs。"""
    if not batch_ids:
        return {}
    rows = (
        await db.execute(
            select(
                Run.batch_id,
                func.count(Run.id),
                func.count(func.distinct(Run.project_id)),
                func.coalesce(func.sum(Run.total), 0),
                func.coalesce(func.sum(Run.passed), 0),
                func.coalesce(func.sum(Run.failed), 0),
                func.min(Run.started_at),
                func.max(Run.ended_at),
                func.coalesce(func.sum(Run.duration_ms), 0),
                func.array_agg(Run.status),
                # 非用例原因（模型额度/配置/网络）导致的失败次数与用例数。
                # 它们和「真实用例失败」必须分开显示，否则会让人去追不存在的 bug。
                func.count(Run.id).filter(Run.failure_kind.is_not(None)),
                func.coalesce(
                    func.sum(Run.failed).filter(Run.failure_kind.is_not(None)), 0
                ),
            )
            .where(Run.batch_id.in_(batch_ids))
            .group_by(Run.batch_id)
        )
    ).all()
    return {
        row[0]: {
            "runs": int(row[1]),
            "project_count": int(row[2]),
            "total": int(row[3]),
            "passed": int(row[4]),
            "failed": int(row[5]),
            "started_at": row[6],
            "ended_at": row[7],
            # 批次耗时是墙钟跨度，不是各 run 耗时之和 —— 分片/跨项目并行时
            # 求和会把并行时间重复计算，看起来像「越并发越慢」。
            "duration_ms": (
                int((row[7] - row[6]).total_seconds() * 1000)
                if row[6] is not None and row[7] is not None
                else int(row[8])
            ),
            "statuses": list(row[9]),
            "excluded_runs": int(row[10]),
            "excluded_failed": int(row[11]),
        }
        for row in rows
    }


async def _feature_breakdown(db, batch_ids: list[uuid.UUID]) -> dict:
    """按「批次 × 功能」聚合用例结果 —— 执行记录每行要显示的多个功能状态。"""
    if not batch_ids:
        return {}
    rows = (
        await db.execute(
            select(
                Run.batch_id,
                Feature.id,
                Feature.name,
                Feature.stage,
                func.count(CaseResult.id),
                func.count(CaseResult.id).filter(CaseResult.status == "success"),
                func.count(CaseResult.id).filter(CaseResult.status == "failed"),
            )
            .join(Run, Run.id == CaseResult.run_id)
            .join(TestCase, TestCase.id == CaseResult.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(Run.batch_id.in_(batch_ids))
            .group_by(Run.batch_id, Feature.id, Feature.name, Feature.stage)
            .order_by(Feature.name)
        )
    ).all()
    out: dict[uuid.UUID, list[dict]] = {}
    for batch_id, fid, fname, fstage, total, passed, failed in rows:
        out.setdefault(batch_id, []).append(
            {
                "feature_id": str(fid),
                "name": fname,
                "stage": fstage,
                "total": int(total),
                "passed": int(passed),
                "failed": int(failed),
            }
        )
    return out


async def _task_info(db, task_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """批次对应的上游测试任务 —— 执行记录要能回答「这是哪个任务、执行了什么」。

    理论上任务删了批次也一起删了；这里查不到就当作没有上游任务（例如历史数据）。
    """
    if not task_ids:
        return {}
    tasks = list(
        (await db.execute(select(TestTask).where(TestTask.id.in_(task_ids)))).scalars()
    )
    if not tasks:
        return {}
    feature_counts = dict(
        (
            await db.execute(
                select(TaskFeature.task_id, func.count())
                .where(TaskFeature.task_id.in_(task_ids))
                .group_by(TaskFeature.task_id)
            )
        ).all()
    )
    case_counts = dict(
        (
            await db.execute(
                select(TaskCase.task_id, func.count())
                .where(TaskCase.task_id.in_(task_ids))
                .group_by(TaskCase.task_id)
            )
        ).all()
    )
    return {
        task.id: {
            "task_name": task.name,
            "task_type": task.type,
            "task_status": task.status,
            "task_feature_count": int(feature_counts.get(task.id, 0)),
            "task_case_count": int(case_counts.get(task.id, 0)),
        }
        for task in tasks
    }


async def _ai_verdicts(db, batch_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str, str | None]]:
    """每个批次最新一次的 AI 结论 —— 执行记录列表上直接能看到 AI 的判断。

    一条 SQL 取全部，避免按行回表（列表默认 100 条）。
    """
    if not batch_ids:
        return {}
    rows = (
        await db.execute(
            select(AiCheck.entity_id, AiCheck.status, AiCheck.verdict)
            .where(AiCheck.entity_type == "batch", AiCheck.entity_id.in_(batch_ids))
            .order_by(AiCheck.entity_id, AiCheck.created_at.desc())
        )
    ).all()
    out: dict[uuid.UUID, tuple[str, str | None]] = {}
    for entity_id, status, verdict in rows:
        out.setdefault(entity_id, (status, verdict))
    return out


@router.get("", response_model=BatchListOut)
async def list_batches(
    user: CurrentUser,
    db: DbSession,
    team_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    iteration_id: uuid.UUID | None = None,
    stage: str | None = None,
    name: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> BatchListOut:
    if team_id is not None:
        await require_team_role(team_id, user, db, "member")
        scope = [team_id]
    else:
        scope = await visible_team_ids(db, user)
        if not scope:
            return BatchListOut(items=[], total=0)

    conditions = _scope(
        team_ids=scope,
        project_id=project_id,
        task_id=task_id,
        iteration_id=iteration_id,
        stage=stage,
        name=name,
    )
    total = (
        await db.execute(select(func.count(RunBatch.id)).where(*conditions))
    ).scalar_one()
    batches = list(
        (
            await db.execute(
                select(RunBatch)
                .where(*conditions)
                .order_by(RunBatch.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )

    ids = [b.id for b in batches]
    aggregates = await _run_aggregates(db, ids)
    features = await _feature_breakdown(db, ids)
    task_info = await _task_info(db, [b.task_id for b in batches if b.task_id])
    ai_verdicts = await _ai_verdicts(db, ids)

    items = []
    for batch in batches:
        agg = aggregates.get(batch.id, {})
        statuses = agg.get("statuses", [])
        task = task_info.get(batch.task_id, {}) if batch.task_id else {}
        ai_status, ai_verdict = ai_verdicts.get(batch.id, (None, None))
        items.append(
            {
                "id": batch.id,
                "task_id": batch.task_id,
                "task_name": task.get("task_name"),
                "task_type": task.get("task_type"),
                "task_status": task.get("task_status"),
                "task_feature_count": task.get("task_feature_count", 0),
                "task_case_count": task.get("task_case_count", 0),
                "ai_status": ai_status,
                "ai_verdict": ai_verdict,
                "team_id": batch.team_id,
                "iteration_id": batch.iteration_id,
                "name": batch.name,
                "trigger": batch.trigger,
                "created_at": batch.created_at,
                "started_at": agg.get("started_at"),
                "ended_at": agg.get("ended_at"),
                "duration_ms": agg.get("duration_ms", 0),
                "runs": agg.get("runs", 0),
                "project_count": agg.get("project_count", 0),
                "total": agg.get("total", 0),
                "passed": agg.get("passed", 0),
                "failed": agg.get("failed", 0),
                "excluded_runs": agg.get("excluded_runs", 0),
                "status": derive_status(
                    statuses,
                    real_failed=agg.get("failed", 0) - agg.get("excluded_failed", 0),
                    excluded_runs=agg.get("excluded_runs", 0),
                ),
                "features": features.get(batch.id, []),
            }
        )
    return BatchListOut(items=items, total=total)


@router.get("/{batch_id}", response_model=BatchDetailOut)
async def get_batch(batch_id: uuid.UUID, user: CurrentUser, db: DbSession) -> BatchDetailOut:
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "执行记录不存在")
    await require_team_role(batch.team_id, user, db, "member")

    runs = list(
        (
            await db.execute(
                select(Run, Project.name)
                .outerjoin(Project, Project.id == Run.project_id)
                .where(Run.batch_id == batch_id)
                .order_by(Run.created_at)
            )
        ).all()
    )
    aggregates = await _run_aggregates(db, [batch_id])
    agg = aggregates.get(batch_id, {})
    features = await _feature_breakdown(db, [batch_id])
    task = (await _task_info(db, [batch.task_id] if batch.task_id else [])).get(
        batch.task_id, {}
    )
    ai_status, ai_verdict = (await _ai_verdicts(db, [batch_id])).get(
        batch_id, (None, None)
    )
    creator = await db.get(User, batch.created_by) if batch.created_by else None
    creator_name = (creator.display_name or creator.username) if creator else None
    team = await db.get(Team, batch.team_id)

    return BatchDetailOut(
        id=batch.id,
        task_id=batch.task_id,
        task_name=task.get("task_name"),
        task_type=task.get("task_type"),
        task_status=task.get("task_status"),
        task_feature_count=task.get("task_feature_count", 0),
        task_case_count=task.get("task_case_count", 0),
        ai_status=ai_status,
        ai_verdict=ai_verdict,
        team_id=batch.team_id,
        team_name=team.name if team else None,
        iteration_id=batch.iteration_id,
        name=batch.name,
        trigger=batch.trigger,
        created_at=batch.created_at,
        created_by_name=creator_name,
        started_at=agg.get("started_at"),
        ended_at=agg.get("ended_at"),
        duration_ms=agg.get("duration_ms", 0),
        runs=agg.get("runs", 0),
        project_count=agg.get("project_count", 0),
        total=agg.get("total", 0),
        passed=agg.get("passed", 0),
        failed=agg.get("failed", 0),
        excluded_runs=agg.get("excluded_runs", 0),
        status=derive_status(
            agg.get("statuses", []),
            real_failed=agg.get("failed", 0) - agg.get("excluded_failed", 0),
            excluded_runs=agg.get("excluded_runs", 0),
        ),
        features=features.get(batch_id, []),
        run_items=[
            {
                "id": run.id,
                "project_id": run.project_id,
                "project_name": project_name,
                "status": run.status,
                "total": run.total,
                "passed": run.passed,
                "failed": run.failed,
                "duration_ms": run.duration_ms,
                "model_name": run.model_name,
                "failure_kind": run.failure_kind,
                "report_available": bool(run.report_html_path),
                "started_at": run.started_at,
                "shard_index": run.shard_index,
                "shard_count": run.shard_count,
            }
            for run, project_name in runs
        ],
    )


# ------------------------------------------------------------- 任务级聚合报告


async def _batch_report_dir(db: DbSession, batch_id: uuid.UUID) -> Path | None:
    """聚合报告放在批次里某个 run 的工作目录下，按新到旧找第一个存在的。"""
    runs = list(
        (
            await db.execute(
                select(Run).where(Run.batch_id == batch_id).order_by(Run.created_at.desc())
            )
        ).scalars()
    )
    for run in runs:
        if not run.work_dir:
            continue
        work_dir = _resolve_data_path(run.work_dir)
        if work_dir is None:
            continue
        candidate = work_dir / "batch-report" / "markdown"
        if candidate.is_dir():
            return candidate
    return None


@router.get("/{batch_id}/report-structured")
async def get_batch_report_structured(
    batch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> dict[str, object]:
    """任务级聚合报告：批次下所有 run 的报告合并成一份（用例 → 步骤 → 关键帧）。"""
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "执行记录不存在")
    await require_team_role(batch.team_id, user, db, "member")

    report_dir = await _batch_report_dir(db, batch_id)
    if report_dir is not None:
        json_path = report_dir / "report.json"
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = None
        if isinstance(data, dict) and data.get("version") == 2:
            return {"available": True, "data": data, "fallback_run_id": None}

    # 老批次没有聚合报告：只有单 run 时可以直接退回那份 run 的报告
    runs = list(
        (
            await db.execute(
                select(Run).where(Run.batch_id == batch_id).order_by(Run.created_at.desc())
            )
        ).scalars()
    )
    fallback = None
    if len(runs) == 1:
        report = _resolve_data_path(runs[0].report_html_path)
        if report is not None and report.exists():
            fallback = str(runs[0].id)
    return {"available": False, "data": None, "fallback_run_id": fallback}


@router.get("/{batch_id}/report-assets/{relative:path}")
async def serve_batch_report_asset(
    batch_id: uuid.UUID, relative: str, db: DbSession
) -> FileResponse:
    """聚合报告的截图等静态资源。

    访问控制和单 run 报告一致：路径里带批次 UUID（不可猜），不再单独做鉴权；
    只允许读 `batch-report/markdown/` 下面，`../` 一律拒绝。
    """
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "执行记录不存在")
    report_dir = await _batch_report_dir(db, batch_id)
    if report_dir is None:
        raise HTTPException(404, "聚合报告不存在")

    root = report_dir.resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise HTTPException(403, "非法路径")
    if not target.is_file():
        raise HTTPException(404, "文件不存在")
    return FileResponse(target)


def _report_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def _active_signoff(db: DbSession, batch_id: uuid.UUID) -> BatchReportSignoff | None:
    return (
        await db.execute(
            select(BatchReportSignoff)
            .where(
                BatchReportSignoff.batch_id == batch_id,
                BatchReportSignoff.revoked_at.is_(None),
            )
            .order_by(BatchReportSignoff.signed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _signoff_state(
    db: DbSession, batch: RunBatch, user: User
) -> BatchSignoffOut:
    report_dir = await _batch_report_dir(db, batch.id)
    report_path = report_dir / "report.json" if report_dir else None
    current_hash: str | None = None
    if report_path is not None and report_path.is_file():
        try:
            data = json.loads(report_path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("version") == 2:
                current_hash = _report_hash(report_path)
        except (OSError, json.JSONDecodeError):
            current_hash = None

    membership = await get_team_membership(db, batch.team_id, user)
    can_sign = membership.role in {"owner", "admin"}
    signoff = await _active_signoff(db, batch.id)
    signer_name = None
    if signoff is not None and signoff.signed_by is not None:
        signer = await db.get(User, signoff.signed_by)
        signer_name = (signer.display_name or signer.username) if signer else None

    return BatchSignoffOut(
        signed=signoff is not None,
        # 报告重新生成/文件被清理后，旧签章不能再当有效凭证
        stale=bool(signoff is not None and current_hash != signoff.report_hash),
        report_available=current_hash is not None,
        report_hash=current_hash,
        can_sign=can_sign,
        signoff=(
            BatchSignoffInfo(
                id=signoff.id,
                report_hash=signoff.report_hash,
                case_count=signoff.case_count,
                passed=signoff.passed,
                failed=signoff.failed,
                note=signoff.note,
                signed_at=signoff.signed_at,
                signed_by_name=signer_name,
            )
            if signoff is not None
            else None
        ),
    )


@router.get("/{batch_id}/report-signoff", response_model=BatchSignoffOut)
async def get_batch_report_signoff(
    batch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> BatchSignoffOut:
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "执行记录不存在")
    await require_team_role(batch.team_id, user, db, "member")
    return await _signoff_state(db, batch, user)


@router.post("/{batch_id}/report-signoff", response_model=BatchSignoffOut)
async def sign_batch_report(
    batch_id: uuid.UUID, body: SignoffIn, user: CurrentUser, db: DbSession
) -> BatchSignoffOut:
    """给某一条执行记录的聚合报告盖章。

    一次签名只作用于当前执行记录；同一条任务的其他执行记录必须单独签。
    签的是报告文件的 sha256，报告一变旧章自动失效。
    """
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "执行记录不存在")
    await require_team_role(batch.team_id, user, db, "admin")

    report_dir = await _batch_report_dir(db, batch_id)
    report_path = report_dir / "report.json" if report_dir else None
    if report_path is None or not report_path.is_file():
        raise HTTPException(409, "聚合报告尚未生成，暂时不能签章")
    try:
        data = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(409, "聚合报告无法读取，暂时不能签章") from exc
    if not isinstance(data, dict) or data.get("version") != 2:
        raise HTTPException(409, "聚合报告版本不支持，暂时不能签章")

    stats = data.get("stats") or {}
    now = datetime.now(UTC)
    # 一条执行记录只保留一个有效签章；旧记录保留作为历史
    await db.execute(
        update(BatchReportSignoff)
        .where(
            BatchReportSignoff.batch_id == batch_id,
            BatchReportSignoff.revoked_at.is_(None),
        )
        .values(revoked_at=now, revoked_by=user.id)
    )
    db.add(
        BatchReportSignoff(
            batch_id=batch_id,
            report_hash=_report_hash(report_path),
            case_count=int(stats.get("cases") or 0),
            passed=int(stats.get("passed") or 0),
            failed=int(stats.get("failed") or 0),
            note=body.note,
            signed_by=user.id,
        )
    )
    await db.commit()
    return await _signoff_state(db, batch, user)


@router.post("/{batch_id}/report-signoff/revoke", response_model=BatchSignoffOut)
async def revoke_batch_report_signoff(
    batch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> BatchSignoffOut:
    batch = await db.get(RunBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "执行记录不存在")
    await require_team_role(batch.team_id, user, db, "admin")
    await db.execute(
        update(BatchReportSignoff)
        .where(
            BatchReportSignoff.batch_id == batch_id,
            BatchReportSignoff.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC), revoked_by=user.id)
    )
    await db.commit()
    return await _signoff_state(db, batch, user)
