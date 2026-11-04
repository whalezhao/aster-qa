"""AI 评估：执行结果评估、签名前预检、团队复盘。

三条原则：
1. **只用项目级模型配置**（和生成用例同一条规则），没有全局兜底；项目没配模型就不评估。
2. **结论只做建议，不阻断任何操作** —— 签名、执行照常可以继续。
3. 结论一律落 `ai_checks`，事后能追溯「当时 AI 说了什么」。

执行结果评估不在 worker 里跑：worker 是串行跑 midscene 的，一次执行几十分钟，
把 AI 调用塞进去会拖住下一个任务。所以走「worker 入队 → API 进程轮询协程处理」。
"""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .ai_case import call_model
from .db import SessionLocal
from .modelconfig import missing_fields
from .models import (
    AiCheck,
    AppSetting,
    CaseResult,
    CaseStability,
    Feature,
    Project,
    ProjectModelConfig,
    Run,
    RunBatch,
    TaskCase,
    TestCase,
    TestTask,
)
from .quota import ensure_quota, record_usage
from .runner import parsers

log = logging.getLogger("ai_review")

POLL_SECONDS = 15
_MODEL_TIMEOUT = 120.0
_MAX_FAILED_CASES = 12

_VERDICT_SCHEMA = """只输出一个 JSON 对象，不要代码块、不要多余解释：
{"verdict":"healthy|risky|needs_attention","headline":"一句话（30 字内）","reasons":["最多 3 条，每条讲清因果"],"advice":["最多 2 条可执行建议"]}
读者是测试经理：不要出现工具名、字段名、英文缩写。"""

# 执行评估比预检多一个「逐条诊断」：每条失败到底该修用例、修产品还是重跑
_ASSESS_SCHEMA = """只输出一个 JSON 对象，不要代码块、不要多余解释：
{"verdict":"healthy|risky|needs_attention","headline":"一句话（30 字内）","reasons":["最多 3 条，每条讲清因果"],"advice":["最多 2 条可执行建议"],"diagnoses":[{"case":"失败用例名","cause":"一句话根因，必须引用失败步骤里看到的现象","owner":"case|product|env","action":"具体建议"}]}
读者是测试经理：不要出现工具名、字段名、英文缩写。
diagnoses 最多 5 条，只诊断事实依据足够的失败用例 —— 依据不足就不写，不要猜。
owner 三选一：case=用例本身写错了（断言/步骤/数据不对），product=产品可能有缺陷，env=环境或测试数据问题。"""


async def _config_for(db: AsyncSession, project_id: uuid.UUID | None) -> ProjectModelConfig | None:
    if project_id is None:
        return None
    config = (
        await db.execute(
            select(ProjectModelConfig).where(ProjectModelConfig.project_id == project_id)
        )
    ).scalar_one_or_none()
    if config is None or missing_fields(config):
        return None
    return config


async def _config_for_batch(db: AsyncSession, batch: RunBatch) -> ProjectModelConfig | None:
    """批次对应的系统：任务的系统优先，跨系统任务取第一个 run 的系统。"""
    task = await db.get(TestTask, batch.task_id) if batch.task_id else None
    if task is not None:
        config = await _config_for(db, task.project_id)
        if config is not None:
            return config
    run = (
        await db.execute(
            select(Run).where(Run.batch_id == batch.id, Run.project_id.is_not(None)).limit(1)
        )
    ).scalar_one_or_none()
    return await _config_for(db, run.project_id if run else None)


def _extract_json(text: str) -> dict[str, Any] | None:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def _ask(
    config: ProjectModelConfig, system: str, user: str, *, json_mode: bool
) -> tuple[str, dict[str, Any] | None, dict]:
    reply, usage = await call_model(
        config,
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        timeout=_MODEL_TIMEOUT,
    )
    return reply, (_extract_json(reply) if json_mode else None), usage


# ------------------------------------------------------------------ 执行结果评估


async def _batch_facts(db: AsyncSession, batch: RunBatch) -> dict[str, Any]:
    runs = list((await db.execute(select(Run).where(Run.batch_id == batch.id))).scalars())
    task = await db.get(TestTask, batch.task_id) if batch.task_id else None

    run_items = []
    failed_cases: list[dict[str, Any]] = []
    evidence: dict[str, list[dict]] = {}
    for run in runs:
        cases = (
            await db.execute(
                select(
                    CaseResult.test_case_id,
                    CaseResult.name,
                    CaseResult.status,
                    CaseResult.attempt_count,
                )
                .where(CaseResult.run_id == run.id)
                .order_by(CaseResult.case_index)
            )
        ).all()
        # 失败用例的 flaky 标记一次查完：逐个用例回表是典型的 N+1（最多 12 次）
        failed_rows = [
            row
            for row in cases
            if str(row[2]).lower() not in {"success", "passed"}
        ][: max(0, _MAX_FAILED_CASES - len(failed_cases))]
        flaky_ids = set(
            (
                await db.execute(
                    select(CaseStability.test_case_id).where(
                        CaseStability.test_case_id.in_(
                            [row[0] for row in failed_rows if row[0]]
                        ),
                        CaseStability.flaky.is_(True),
                    )
                )
            ).scalars()
        )
        for case_id, name, status, attempts in failed_rows:
            failed_cases.append(
                {
                    "case": name,
                    "status": status,
                    "attempts": attempts,
                    "known_flaky": case_id in flaky_ids,
                }
            )
        # 从产物里读失败步骤的原始理由 —— 只有计数的话，AI 只能猜，等于没有依据
        for item in (
            parsers.read_case_evidence(Path(run.result_dir)) if run.result_dir else []
        ):
            if len(evidence) >= _MAX_FAILED_CASES:
                break
            key = item.get("case") or "未命名用例"
            evidence.setdefault(key, []).extend(item.get("steps") or [])
        run_items.append(
            {
                "status": run.status,
                "total": run.total,
                "passed": run.passed,
                "failed": run.failed,
                "failure_kind": run.failure_kind,
                "duration_ms": run.duration_ms,
                "model": run.model_name,
                "error": (run.error_message or "")[:400] or None,
            }
        )

    for row in failed_cases:
        if steps := evidence.pop(row["case"] or "未命名用例", None):
            row["steps"] = steps
    # 用例名对不上（例如库里的记录被重建过）时也别丢依据，单独附上
    failed_cases.extend({"case": name, "steps": steps} for name, steps in evidence.items())

    return {
        "task": task.name if task else None,
        "task_type": task.type if task else None,
        "runs": run_items,
        "failed_cases": failed_cases,
        "trigger": batch.trigger,
        "name": batch.name,
    }


async def assess_batch(db: AsyncSession, batch: RunBatch) -> tuple[dict[str, Any], str]:
    """返回 (结论, 模型名)。"""
    config = await _config_for_batch(db, batch)
    if config is None:
        raise RuntimeError("该批次所属系统未配置模型，跳过 AI 评估")
    # 额度用尽就不调模型；run_check 会把这条 RuntimeError 记成 check 失败原因
    await ensure_quota(db, config.project_id, config)
    facts = await _batch_facts(db, batch)
    system = (
        "你是资深测试负责人，负责判断一次自动化回归结果的可信度。\n"
        "判定口径：\n"
        "- healthy：通过率高，失败集中在明确的功能问题，没有大面积重试/flaky 迹象；\n"
        "- risky：失败不少但能解释（例如集中在一个功能），或存在明显 flaky（重试后才过）；\n"
        "- needs_attention：失败面广，或失败疑似环境/模型额度问题，或大量 flaky，需要人工排查。\n"
        "事实依据：failed_cases[].steps 是失败用例实际执行过的步骤 —— action 是当时的"
        "指令，result 是执行结果，reason 是失败那一步给出的理由。reasons 里每条结论都必须"
        "引用这些具体事实（哪一步、看到什么、为什么失败），不要只复述通过率；"
        "事实不足以支撑的推测不要写，信息不够就直说信息不足。\n"
        "注意：AI 执行本身时过时不过属于常态，单次失败不等价于缺陷。\n" + _ASSESS_SCHEMA
    )
    reply, parsed, usage = await _ask(
        config, system, json.dumps(facts, ensure_ascii=False), json_mode=True
    )
    await record_usage(db, config.project_id, "assess", usage)
    if parsed is None:
        parsed = {"verdict": "needs_attention", "headline": reply[:120], "reasons": [], "advice": []}
    return parsed, (config.model_name or "-")


# ------------------------------------------------------------------ 签名前预检


async def task_precheck(db: AsyncSession, task: TestTask) -> tuple[dict[str, Any], str]:
    config = await _config_for(db, task.project_id)
    if config is None:
        raise RuntimeError("该系统未配置模型，无法做 AI 预检")
    await ensure_quota(db, config.project_id, config)

    case_count = (
        await db.execute(
            select(func.count()).select_from(TaskCase).where(TaskCase.task_id == task.id)
        )
    ).scalar_one()
    last_batch = (
        await db.execute(
            select(RunBatch)
            .where(RunBatch.task_id == task.id)
            .order_by(RunBatch.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    last_summary = await _batch_facts(db, last_batch) if last_batch is not None else None
    flaky = (
        await db.execute(
            select(func.count())
            .select_from(TaskCase)
            .join(CaseStability, CaseStability.test_case_id == TaskCase.case_id)
            .where(TaskCase.task_id == task.id, CaseStability.flaky.is_(True))
        )
    ).scalar_one()

    facts = {
        "task": task.name,
        "type": task.type,
        "status": task.status,
        "case_count": case_count,
        "flaky_cases_in_task": flaky,
        "last_run": last_summary,
    }
    system = (
        "你在做测试任务签名前的人工审核预检。签名意味着「这批用例经过人工认可」。\n"
        "判断这批用例现在签下去是否靠谱：用例是否足够、最近一次执行有没有明显问题、"
        "有没有已知不稳定的用例、失败是否可解释。\n"
        "请注意你只是给建议，不阻止签名。\n" + _VERDICT_SCHEMA
    )
    reply, parsed, usage = await _ask(
        config, system, json.dumps(facts, ensure_ascii=False), json_mode=True
    )
    await record_usage(db, config.project_id, "precheck", usage)
    if parsed is None:
        parsed = {"verdict": "risky", "headline": reply[:120], "reasons": [], "advice": []}
    return parsed, (config.model_name or "-")


# ------------------------------------------------------------------ 团队复盘


async def team_review(db: AsyncSession, team_id: uuid.UUID, days: int) -> tuple[str, str]:
    """返回 (markdown 报告, 模型名)。"""
    since = datetime.now(UTC) - timedelta(days=days)
    runs = list(
        (
            await db.execute(
                select(Run).where(Run.team_id == team_id, Run.created_at >= since)
            )
        ).scalars()
    )
    if not runs:
        raise RuntimeError("最近这段时间没有执行记录，没什么可复盘的")

    total = sum(int(r.total or 0) for r in runs)
    passed = sum(int(r.passed or 0) for r in runs)
    failed = sum(int(r.failed or 0) for r in runs)
    projects = list(
        (await db.execute(select(Project).where(Project.team_id == team_id))).scalars()
    )
    top_failures = (
        await db.execute(
            select(CaseResult.name, func.count().label("fails"))
            .where(
                CaseResult.run_id.in_([r.id for r in runs]),
                CaseResult.status == "failed",
            )
            .group_by(CaseResult.name)
            .order_by(func.count().desc())
            .limit(8)
        )
    ).all()
    flaky = (
        await db.execute(
            select(func.count())
            .select_from(CaseStability)
            .join(TestCase, TestCase.id == CaseStability.test_case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .join(Project, Project.id == Feature.project_id)
            .where(Project.team_id == team_id, CaseStability.flaky.is_(True))
        )
    ).scalar_one()

    facts = {
        "days": days,
        "runs": len(runs),
        "cases_run": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": round(passed / total, 4) if total else None,
        "projects": [p.name for p in projects],
        "top_failed_cases": [{"case": n, "fails": c} for n, c in top_failures],
        "flaky_cases": int(flaky),
    }

    # 复盘没有单一项目上下文：取团队里第一个配好模型、且本月额度还没用尽的项目
    config = None
    for project in projects:
        candidate = await _config_for(db, project.id)
        if candidate is None:
            continue
        try:
            await ensure_quota(db, project.id, candidate)
        except RuntimeError:
            continue
        config = candidate
        break
    if config is None:
        raise RuntimeError("这个测试团队下的系统都没配模型，或本月 token 额度都已用尽")

    system = (
        "你是测试团队负责人，要给测试团队写一份最近测试情况的复盘。\n"
        "要求：200~350 字；用 Markdown（小标题 + 少量表格或列表）；\n"
        "结构：1) 一句话结论 2) 主要发现（2~3 条，讲因果，不要只报数字） 3) 可执行的改进建议（2~3 条）。\n"
        "注意 AI 执行时过时不过属于常态，不要把单次失败当缺陷；要区分「用例不稳」和「功能有问题」。\n"
        "读者是测试经理和开发，不要出现工具名、字段名。"
    )
    reply, _, usage = await _ask(
        config, system, json.dumps(facts, ensure_ascii=False), json_mode=False
    )
    await record_usage(db, config.project_id, "team_review", usage)
    return reply.strip(), (config.model_name or "-")


# ------------------------------------------------------------------ 队列与轮询


async def enqueue_batch_check(db: AsyncSession, batch_id: uuid.UUID) -> None:
    """worker 在批次收尾时调用：同一批次只入队一次。

    设置里勾了「仅评估有失败的批次」时，全绿的批次直接跳过 —— 每次评估都是一次
    真实的模型调用，而全绿批次没有需要诊断的东西。
    """
    setting = await db.get(AppSetting, 1)
    if setting is not None and setting.ai_assess_failures_only:
        failed = (
            await db.execute(
                select(func.coalesce(func.sum(Run.failed), 0)).where(
                    Run.batch_id == batch_id, Run.failure_kind.is_(None)
                )
            )
        ).scalar_one()
        if int(failed) == 0:
            return

    exists = (
        await db.execute(
            select(AiCheck.id).where(
                AiCheck.entity_type == "batch", AiCheck.entity_id == batch_id
            )
        )
    ).first()
    if exists is None:
        db.add(AiCheck(entity_type="batch", entity_id=batch_id, status="pending"))


def _detail(result: dict[str, Any]) -> dict[str, Any]:
    """结论落库的统一形状。diagnoses 来自模型，形状不可全信 —— 只收 dict、最多 5 条。"""
    diagnoses = [item for item in (result.get("diagnoses") or []) if isinstance(item, dict)]
    return {
        "reasons": result.get("reasons") or [],
        "advice": result.get("advice") or [],
        "diagnoses": diagnoses[:5],
    }


async def run_check(db: AsyncSession, check: AiCheck) -> None:
    try:
        if check.entity_type != "batch":
            raise RuntimeError(f"不支持的检查类型：{check.entity_type}")
        batch = await db.get(RunBatch, check.entity_id)
        if batch is None:
            raise RuntimeError("批次已不存在")
        result, model_name = await assess_batch(db, batch)
        check.verdict = str(result.get("verdict") or "unknown")
        check.summary = str(result.get("headline") or "")
        check.detail = _detail(result)
        check.model_name = model_name
        check.status = "done"
        check.error = None

        # 评估完再推一条 webhook，Octo 上就能看到 AI 结论
        from .webhook import enqueue

        await enqueue(db, team_id=batch.team_id, event="batch.assessed", ref_id=batch.id)
    except RuntimeError as exc:
        # 我们自己抛的、要原样给用户看的（例如「该项目未配置模型」）
        check.status = "failed"
        check.error = str(exc)[:500]
        log.warning("ai check %s 跳过：%s", check.id, exc)
    except Exception:
        # 模型/网络/数据库的意外错误：完整堆栈进日志，界面上只给一句人话，
        # 免得把服务端细节漏给普通成员
        check.status = "failed"
        check.error = "AI 调用失败，详见服务端日志"
        log.exception("ai check %s 失败", check.id)
    finally:
        check.finished_at = datetime.now(UTC)


async def assess_loop() -> None:
    """API 进程里的常驻协程：认领 pending 的检查，调模型，写回结论。"""
    while True:
        try:
            async with SessionLocal() as db:
                check = (
                    await db.execute(
                        select(AiCheck)
                        .where(AiCheck.status == "pending")
                        .order_by(AiCheck.created_at)
                        .limit(1)
                        .with_for_update(skip_locked=True)
                    )
                ).scalar_one_or_none()
                if check is not None:
                    await run_check(db, check)
                    await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("AI 评估轮询出错")
        await asyncio.sleep(POLL_SECONDS)


async def latest_check(
    db: AsyncSession, entity_type: str, entity_id: uuid.UUID
) -> AiCheck | None:
    return (
        await db.execute(
            select(AiCheck)
            .where(AiCheck.entity_type == entity_type, AiCheck.entity_id == entity_id)
            .order_by(AiCheck.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def save_check(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    result: dict[str, Any],
    model_name: str,
) -> AiCheck:
    check = AiCheck(
        entity_type=entity_type,
        entity_id=entity_id,
        status="done",
        verdict=str(result.get("verdict") or "unknown"),
        summary=str(result.get("headline") or ""),
        detail=_detail(result),
        model_name=model_name,
        finished_at=datetime.now(UTC),
    )
    db.add(check)
    await db.flush()
    return check


async def save_review(
    db: AsyncSession, *, team_id: uuid.UUID, markdown: str, model_name: str
) -> AiCheck:
    check = AiCheck(
        entity_type="team",
        entity_id=team_id,
        status="done",
        summary=(markdown.splitlines()[0][:120] if markdown else ""),
        detail={"markdown": markdown},
        model_name=model_name,
        finished_at=datetime.now(UTC),
    )
    db.add(check)
    await db.flush()
    return check
