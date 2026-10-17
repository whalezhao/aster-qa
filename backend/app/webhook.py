"""webhook：payload 构造、HMAC 签名、异步投递。

**为什么投递不在 worker 里做**：worker 是串行跑 midscene 的，一次执行可能几十分钟。
把 webhook 挂在它后面，意味着「点个签名要等半小时才发出去」。所以投递由 API 进程里的
一个独立协程负责，队列就是 `webhook_deliveries` 表（取 status='pending' 且到点的行，
`FOR UPDATE SKIP LOCKED`，和执行队列同一套认领方式）。

**payload 入队时固化**：重试要发同一份字节。重新构造一遍只要有一个字段变了，
接收方按 body 验签就会失败。

仿 GitLab 的两层凭据：
- `X-QA-Token`：每个 webhook 自己的密钥，接收方直接比对（GitLab 的 secret token）。
- `X-QA-Signature: sha256=<hmac>` + `X-QA-Timestamp`：对 `时间戳.原始body` 做 HMAC，
  防篡改 + 防重放（GitLab 的签名方案）。
"""

import asyncio
import hashlib
import hmac
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .ids import split_ids
from .models import (
    AiCheck,
    CaseResult,
    Feature,
    Iteration,
    Project,
    ProjectModelHealth,
    Run,
    RunBatch,
    Tag,
    TaskCase,
    TaskSchedule,
    TaskSignoff,
    TaskTag,
    Team,
    TestCase,
    TestTask,
    User,
    Webhook,
    WebhookDelivery,
)
from .webhook_channels import provider_business_error, render_provider_request

log = logging.getLogger("webhook")

# 首批只开这两个。用例增删改、功能转正式这类事件噪音大、接收方多半也不处理，
# 需要时再加 —— 信封里的 event 字段保证加事件不会破坏已有接收方。
EVENTS: dict[str, str] = {
    "task.signed": "任务签名（人工审核通过）",
    "batch.completed": "一次执行完成",
    "batch.assessed": "AI 评估完成（给出结果结论与建议）",
    "quality_gate.failed": "质量门禁未通过",
    "schedule.failed": "定时执行失败",
    "model.unhealthy": "项目模型不可用",
    "ping": "测试投递（配好之后点一下看通不通）",
}

POLL_SECONDS = 5
MAX_ATTEMPTS = 6  # 1m → 2m → 4m → 8m → 16m → 30m，之后放弃
REQUEST_TIMEOUT = 10.0
_SNIPPET = 500


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


def _user(u: User | None) -> dict[str, Any] | None:
    if u is None:
        return None
    return {"id": str(u.id), "username": u.username, "display_name": u.display_name}


async def case_set_hash(db: AsyncSession, task_id: uuid.UUID) -> tuple[str, int]:
    """任务用例集的内容指纹 + 条数。

    按用例 id 排序后逐条喂 sha256，所以同一份集合每次算出来都一样；改了任何一条
    用例的名称或 YAML，指纹就变。
    """
    rows = (
        await db.execute(
            select(TestCase.id, TestCase.name, TestCase.yaml_content, Feature.name)
            .join(TaskCase, TaskCase.case_id == TestCase.id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(TaskCase.task_id == task_id)
        )
    ).all()
    digest = hashlib.sha256()
    for cid, name, yaml, feature_name in sorted(rows, key=lambda r: str(r[0])):
        digest.update(f"{cid}\x00{name}\x00{feature_name}\x00{yaml}\x00".encode())
    return digest.hexdigest(), len(rows)


async def _task_context(db: AsyncSession, task: TestTask, include_yaml: bool) -> dict[str, Any]:
    """团队 / 项目 / 迭代 / 标签 / 任务 / 功能 / 用例 —— 签名事件要发的全套。"""
    team = await db.get(Team, task.team_id)
    project = await db.get(Project, task.project_id) if task.project_id else None
    iteration = await db.get(Iteration, task.iteration_id) if task.iteration_id else None

    tags = (
        await db.execute(
            select(Tag.id, Tag.name)
            .join(TaskTag, TaskTag.tag_id == Tag.id)
            .where(TaskTag.task_id == task.id)
            .order_by(Tag.name)
        )
    ).all()

    features = (
        await db.execute(
            select(Feature.id, Feature.name, Feature.stage, Feature.requirement_ids)
            .join(TaskCase, TaskCase.source_feature_id == Feature.id)
            .where(TaskCase.task_id == task.id)
            .distinct()
            .order_by(Feature.name)
        )
    ).all()

    cases = (
        await db.execute(
            select(
                TestCase.id,
                TestCase.name,
                TestCase.priority,
                TestCase.defect_ids,
                TestCase.yaml_content,
                Feature.id,
                Feature.name,
                Feature.requirement_ids,
            )
            .join(TaskCase, TaskCase.case_id == TestCase.id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(TaskCase.task_id == task.id)
            .order_by(Feature.name, TestCase.name)
        )
    ).all()

    case_items: list[dict[str, Any]] = []
    for cid, cname, priority, defect_ids, yaml_content, fid, fname, req_ids in cases:
        item: dict[str, Any] = {
            "id": str(cid),
            "name": cname,
            "priority": priority,
            "defect_ids": split_ids(defect_ids),
            "feature_id": str(fid),
            "feature_name": fname,
            "feature_requirement_ids": split_ids(req_ids),
        }
        # YAML 正文是唯一能把 payload 顶到几百 KB 的东西，默认不发
        if include_yaml:
            item["yaml_content"] = yaml_content
        case_items.append(item)

    signoff = (
        await db.execute(
            select(TaskSignoff)
            .where(TaskSignoff.task_id == task.id, TaskSignoff.revoked_at.is_(None))
            .order_by(TaskSignoff.signed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    signer = await db.get(User, signoff.signed_by) if signoff and signoff.signed_by else None

    return {
        "team": {"id": str(team.id), "name": team.name} if team else None,
        "project": (
            {"id": str(project.id), "name": project.name, "code": project.code}
            if project
            else None
        ),
        "iteration": (
            {"id": str(iteration.id), "name": iteration.name, "version": iteration.version}
            if iteration
            else None
        ),
        "tags": [{"id": str(tid), "name": tname} for tid, tname in tags],
        "task": {
            "id": str(task.id),
            "name": task.name,
            "type": task.type,
            "status": task.status,
            "description": task.description,
            "created_at": _iso(task.created_at),
            "case_count": len(case_items),
        },
        # 人审签名：内容指纹 + 签名人。接收方拿 case_hash 就能自己校验
        # 「我收到的这版用例是不是当初签的那版」。
        "signoff": (
            {
                "case_hash": signoff.case_hash,
                "case_count": signoff.case_count,
                "note": signoff.note,
                "signed_at": _iso(signoff.signed_at),
                "signed_by": _user(signer),
            }
            if signoff
            else None
        ),
        "features": [
            {
                "id": str(fid),
                "name": fname,
                "stage": stage,
                "requirement_ids": split_ids(req),
            }
            for fid, fname, stage, req in features
        ],
        "cases": case_items,
    }


async def _batch_context(db: AsyncSession, batch: RunBatch) -> dict[str, Any]:
    team = await db.get(Team, batch.team_id)
    task = await db.get(TestTask, batch.task_id) if batch.task_id else None
    project = await db.get(Project, task.project_id) if task and task.project_id else None
    iteration = await db.get(Iteration, batch.iteration_id) if batch.iteration_id else None

    runs = list((await db.execute(select(Run).where(Run.batch_id == batch.id))).scalars())
    run_items = []
    for run in runs:
        cases = (
            await db.execute(
                select(CaseResult.name, CaseResult.status, CaseResult.attempt_count)
                .where(CaseResult.run_id == run.id)
                .order_by(CaseResult.case_index, CaseResult.name)
            )
        ).all()
        run_items.append(
            {
                "id": str(run.id),
                "project_id": str(run.project_id) if run.project_id else None,
                "status": run.status,
                "failure_kind": run.failure_kind,
                "total": run.total,
                "passed": run.passed,
                "failed": run.failed,
                "duration_ms": run.duration_ms,
                "model_name": run.model_name,
                "started_at": _iso(run.started_at),
                "ended_at": _iso(run.ended_at),
                # 报告是能力 URL（路径里带 run 的 UUID），接收方拼上平台地址就能打开
                "report_path": f"/reports/{run.id}/index.html" if run.report_html_path else None,
                "cases": [{"name": n, "status": s, "attempt_count": a} for n, s, a in cases],
            }
        )

    return {
        "team": {"id": str(team.id), "name": team.name} if team else None,
        "project": (
            {"id": str(project.id), "name": project.name, "code": project.code}
            if project
            else None
        ),
        "iteration": (
            {"id": str(iteration.id), "name": iteration.name, "version": iteration.version}
            if iteration
            else None
        ),
        "task": {"id": str(task.id), "name": task.name, "type": task.type} if task else None,
        "batch": {
            "id": str(batch.id),
            "name": batch.name,
            "trigger": batch.trigger,
            "environment_name": batch.environment_name,
            "created_at": _iso(batch.created_at),
            # RunBatch 上没有 started_at/ended_at（批次指标一律现算），这里取各 run 的
            # 最早开始 / 最晚结束 —— 直接读 batch 上的字段会 AttributeError 把 worker 打挂
            "started_at": _iso(min((r.started_at for r in runs if r.started_at), default=None)),
            "ended_at": _iso(max((r.ended_at for r in runs if r.ended_at), default=None)),
        },
        "runs": run_items,
    }


async def build_payload(
    db: AsyncSession, event: str, ref_id: uuid.UUID, include_yaml: bool
) -> dict[str, Any]:
    """按事件类型构造 body。调用方保证 ref_id 对该事件有意义。"""
    # event_type 是 event 的别名：有的接收端（网关类）只认这个标准字段名。
    # 两个都发，接收方按哪种口径筛都行。
    envelope = {"event": event, "event_type": event, "occurred_at": _iso(datetime.now(UTC))}
    if event == "task.signed":
        task = await db.get(TestTask, ref_id)
        if task is None:
            raise ValueError("任务不存在")
        return {**envelope, "data": await _task_context(db, task, include_yaml)}
    if event == "batch.completed":
        batch = await db.get(RunBatch, ref_id)
        if batch is None:
            raise ValueError("批次不存在")
        return {**envelope, "data": await _batch_context(db, batch)}
    if event == "batch.assessed":
        check = (
            await db.execute(
                select(AiCheck)
                .where(AiCheck.entity_type == "batch", AiCheck.entity_id == ref_id)
                .order_by(AiCheck.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        batch = await db.get(RunBatch, ref_id)
        if check is None or batch is None:
            raise ValueError("AI 评估不存在")
        task = await db.get(TestTask, batch.task_id) if batch.task_id else None
        team = await db.get(Team, batch.team_id)
        return {
            **envelope,
            "data": {
                "team": {"id": str(team.id), "name": team.name} if team else None,
                "task": (
                    {"id": str(task.id), "name": task.name, "type": task.type} if task else None
                ),
                "batch": {"id": str(batch.id), "name": batch.name},
                "assessment": {
                    "verdict": check.verdict,
                    "headline": check.summary,
                    "reasons": (check.detail or {}).get("reasons") or [],
                    "advice": (check.detail or {}).get("advice") or [],
                    "model": check.model_name,
                },
            },
        }
    if event == "quality_gate.failed":
        batch = await db.get(RunBatch, ref_id)
        if batch is None:
            raise ValueError("批次不存在")
        return {
            **envelope,
            "data": {
                **await _batch_context(db, batch),
                "gate": batch.gate_detail or {},
            },
        }
    if event == "schedule.failed":
        schedule = await db.get(TaskSchedule, ref_id)
        if schedule is None:
            raise ValueError("定时计划不存在")
        task = await db.get(TestTask, schedule.task_id)
        return {
            **envelope,
            "data": {
                "schedule": {
                    "id": str(schedule.id),
                    "cron": schedule.cron,
                    "timezone": schedule.timezone,
                    "error": schedule.last_error,
                    "last_run_at": _iso(schedule.last_run_at),
                },
                "task": (
                    {"id": str(task.id), "name": task.name, "type": task.type}
                    if task
                    else None
                ),
            },
        }
    if event == "model.unhealthy":
        project = await db.get(Project, ref_id)
        health = await db.get(ProjectModelHealth, ref_id)
        if project is None or health is None:
            raise ValueError("项目或健康记录不存在")
        return {
            **envelope,
            "data": {
                "project": {
                    "id": str(project.id),
                    "name": project.name,
                    "code": project.code,
                },
                "health": {
                    "status": health.status,
                    "message": health.message,
                    "model_name": health.model_name,
                    "latency_ms": health.latency_ms,
                    "checked_at": _iso(health.checked_at),
                    "source": health.source,
                },
            },
        }
    if event == "ping":
        return {**envelope, "data": {"message": "这是一条测试投递，通了。"}}
    raise ValueError(f"未知事件：{event}")


async def task_ping_payload(
    db: AsyncSession, task: TestTask, include_yaml: bool
) -> dict[str, Any]:
    """测试投递：跟签名事件发同一套数据，接收方可以照它把解析逻辑先写好。"""
    return {
        "event": "ping",
        "occurred_at": _iso(datetime.now(UTC)),
        "data": await _task_context(db, task, include_yaml),
    }


async def enqueue(
    db: AsyncSession, *, team_id: uuid.UUID, event: str, ref_id: uuid.UUID
) -> int:
    """把事件投进每个订阅了它的 webhook 的队列（不提交，交给调用方的事务）。

    payload 按每个 webhook 自己的 include_yaml 生成 —— 不想要 YAML 的接收方
    不该被另一个接收方的开关绑架。
    """
    hooks = list(
        (
            await db.execute(
                select(Webhook).where(Webhook.team_id == team_id, Webhook.is_active.is_(True))
            )
        ).scalars()
    )
    queued = 0
    for hook in hooks:
        if event not in split_ids(hook.events):
            continue
        payload = await build_payload(
            db, event, ref_id, hook.include_yaml and hook.kind == "generic"
        )
        db.add(WebhookDelivery(webhook_id=hook.id, event=event, payload=payload))
        queued += 1
    return queued


def sign_v2(secret: str, timestamp: str, body: bytes) -> str:
    """通用 HMAC V2：`HMAC(secret, "<timestamp>.<body>")` 的裸 hex（不带前缀）。

    和 `X-QA-Signature` 是同一个构造，只是不带 "sha256=" 前缀 —— 因为
    不少自建网关（含 Hermes/standard-webhooks 那一系）就是这么验的：
    它把时间戳一起签进去，能防重放。
    """
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """对 `时间戳.原始body` 做 HMAC —— 接收方要用**原始字节**验，别反序列化后再序列化。"""
    return f"sha256={sign_v2(secret, timestamp, body)}"


async def _send(
    client: httpx.AsyncClient, url: str, body: bytes, headers: dict[str, str]
) -> tuple[int | None, str | None, str | None]:
    """发一次，返回 (状态码, 响应片段, 错误)。

    网络层的锅要变成返回值 —— 一次投递失败不能把整个循环带走。
    只抓 HTTPError（超时/连不上）和 OSError（证书/系统层），别的照常抛。
    """
    try:
        resp = await client.post(url, content=body, headers=headers)
    except (httpx.HTTPError, OSError) as exc:
        return None, None, f"{type(exc).__name__}: {exc}"[:300]
    return resp.status_code, resp.text[:_SNIPPET], None


async def _deliver_due(db: AsyncSession) -> int:
    rows = (
        await db.execute(
            select(WebhookDelivery, Webhook)
            .join(Webhook, Webhook.id == WebhookDelivery.webhook_id)
            .where(
                WebhookDelivery.status == "pending",
                WebhookDelivery.next_attempt_at <= func.now(),
            )
            .order_by(WebhookDelivery.next_attempt_at)
            .limit(20)
            .with_for_update(skip_locked=True, of=WebhookDelivery)
        )
    ).all()

    sent = 0
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=False) as client:
        for delivery, hook in rows:
            rendered = render_provider_request(
                hook.kind, hook.url, hook.secret, delivery.event, delivery.payload
            )
            if rendered is not None:
                url, body, headers = rendered
                headers.update(
                    {"X-QA-Event": delivery.event, "X-QA-Delivery": str(delivery.id)}
                )
            else:
                if not hook.secret:
                    delivery.attempts += 1
                    delivery.error = "generic webhook 未配置 secret"
                    if delivery.attempts >= MAX_ATTEMPTS:
                        delivery.status = "failed"
                        delivery.finished_at = datetime.now(UTC)
                    else:
                        delivery.next_attempt_at = datetime.now(UTC) + timedelta(
                            seconds=min(1800, 60 * 2 ** (delivery.attempts - 1))
                        )
                    continue
                url = hook.url
                body = json.dumps(
                    delivery.payload, ensure_ascii=False, separators=(",", ":")
                ).encode()
                timestamp = str(int(datetime.now(UTC).timestamp()))
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "aster-qa-webhook/1",
                    "X-QA-Event": delivery.event,
                    "X-QA-Delivery": str(delivery.id),
                    "X-QA-Timestamp": timestamp,
                    "X-QA-Token": hook.secret,
                    "X-QA-Signature": sign(hook.secret, timestamp, body),
                    # 通用 HMAC V2：给认这一套的接收端（Hermes 等自建网关）用同一把密钥验签
                    "X-Webhook-Timestamp": timestamp,
                    "X-Webhook-Signature-V2": sign_v2(hook.secret, timestamp, body),
                }

            delivery.attempts += 1
            status_code, snippet, error = await _send(client, url, body, headers)
            delivery.response_status = status_code
            delivery.response_snippet = snippet
            business_error = provider_business_error(
                hook.kind, status_code or 0, snippet or ""
            )
            if (
                status_code is not None
                and 200 <= status_code < 300
                and business_error is None
            ):
                delivery.status = "success"
                delivery.finished_at = datetime.now(UTC)
                delivery.error = None
                sent += 1
                continue
            delivery.error = error or business_error or f"HTTP {status_code}"

            if delivery.attempts >= MAX_ATTEMPTS:
                delivery.status = "failed"
                delivery.finished_at = datetime.now(UTC)
            else:
                delivery.next_attempt_at = datetime.now(UTC) + timedelta(
                    seconds=min(1800, 60 * 2 ** (delivery.attempts - 1))
                )

    await db.commit()
    return sent


async def deliver_loop() -> None:
    """API 进程里的常驻协程。异常一律吞掉继续跑 —— 投递失败不能把服务带崩。"""
    while True:
        try:
            async with SessionLocal() as db:
                await _deliver_due(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("webhook 投递循环出错")
        await asyncio.sleep(POLL_SECONDS)
