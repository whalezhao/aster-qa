"""webhook 配置与投递记录。

挂在**团队**下 —— 团队是这套系统的租户边界，别的配置（项目、迭代、标签、任务）都在团队里。
一个团队可以配多个 webhook，各自选订阅哪些事件，形如 GitLab。
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, select, update

from ..deps import CurrentUser, DbSession, require_team_role
from ..models import TestTask, Webhook, WebhookDelivery
from ..schemas import (
    WebhookCreate,
    WebhookDeliveryOut,
    WebhookOut,
    WebhookUpdate,
)
from ..webhook import EVENTS, build_payload, split_ids, task_ping_payload

router = APIRouter(tags=["webhooks"])


KINDS = {"generic", "wecom", "feishu", "dingtalk", "slack"}


def _out(hook: Webhook, last: WebhookDelivery | None = None) -> WebhookOut:
    return WebhookOut(
        id=hook.id,
        team_id=hook.team_id,
        name=hook.name,
        kind=hook.kind,
        url=hook.url,
        events=split_ids(hook.events),
        include_yaml=hook.include_yaml,
        is_active=hook.is_active,
        created_by=hook.created_by,
        created_at=hook.created_at,
        # 密钥只回「设没设」。注意它不像 API Key 那样只存哈希 ——
        # HMAC 验签必须拿到原文，所以它的保护级别等同于数据库本身。
        secret_set=bool(hook.secret),
        last_delivery_at=last.created_at if last else None,
        last_delivery_status=last.status if last else None,
    )


def _validate(url: str, events: list[str], kind: str, secret: str | None) -> None:
    if kind not in KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "未知通知渠道类型")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "地址必须以 http:// 或 https:// 开头")
    unknown = [e for e in events if e not in EVENTS]
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"未知事件：{'、'.join(unknown)}")
    if not events:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "至少要订阅一个事件")
    if kind == "generic" and not secret:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "通用 Webhook 必须设置签名密钥"
        )


async def _require_hook(db, webhook_id: uuid.UUID, user, minimum: str = "admin") -> Webhook:
    hook = await db.get(Webhook, webhook_id)
    if hook is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "webhook 不存在")
    await require_team_role(hook.team_id, user, db, minimum)
    return hook


async def _last_deliveries(db, hook_ids: list[uuid.UUID]) -> dict[uuid.UUID, WebhookDelivery]:
    """每个 webhook 最近一次投递 —— 列表上要能一眼看出「通不通」。"""
    if not hook_ids:
        return {}
    rows = (
        await db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.webhook_id.in_(hook_ids))
            .order_by(WebhookDelivery.webhook_id, WebhookDelivery.created_at.desc())
        )
    ).scalars()
    latest: dict[uuid.UUID, WebhookDelivery] = {}
    for row in rows:
        latest.setdefault(row.webhook_id, row)
    return latest


@router.get("/api/webhook-events")
async def list_event_types(user: CurrentUser) -> list[dict[str, str]]:
    """可选事件清单，前端直接渲染成勾选项。"""
    return [{"event": e, "label": label} for e, label in EVENTS.items()]


@router.get("/api/teams/{team_id}/webhooks", response_model=list[WebhookOut])
async def list_webhooks(
    team_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[WebhookOut]:
    # 只有管理员能看：URL 和投递记录属于团队的基础设施信息，普通成员不需要
    await require_team_role(team_id, user, db, "admin")
    hooks = list(
        (
            await db.execute(
                select(Webhook).where(Webhook.team_id == team_id).order_by(Webhook.created_at)
            )
        ).scalars()
    )
    latest = await _last_deliveries(db, [h.id for h in hooks])
    return [_out(h, latest.get(h.id)) for h in hooks]


@router.post(
    "/api/teams/{team_id}/webhooks",
    response_model=WebhookOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_webhook(
    team_id: uuid.UUID, body: WebhookCreate, user: CurrentUser, db: DbSession
) -> WebhookOut:
    await require_team_role(team_id, user, db, "admin")
    _validate(body.url, body.events, body.kind, body.secret)
    hook = Webhook(
        team_id=team_id,
        name=body.name,
        kind=body.kind,
        url=body.url,
        secret=(body.secret or "").strip() or None,
        events=",".join(body.events),
        include_yaml=body.include_yaml and body.kind == "generic",
        is_active=body.is_active,
        created_by=user.id,
    )
    db.add(hook)
    await db.commit()
    await db.refresh(hook)
    return _out(hook)


@router.patch("/api/webhooks/{webhook_id}", response_model=WebhookOut)
async def update_webhook(
    webhook_id: uuid.UUID, body: WebhookUpdate, user: CurrentUser, db: DbSession
) -> WebhookOut:
    hook = await _require_hook(db, webhook_id, user)
    fields = body.model_dump(exclude_unset=True)
    kind = fields.get("kind", hook.kind)
    secret = fields.get("secret", hook.secret)
    _validate(
        fields.get("url", hook.url),
        fields.get("events") or split_ids(hook.events),
        kind,
        (secret or "").strip() or None,
    )
    if "events" in fields:
        hook.events = ",".join(fields.pop("events"))
    if "secret" in fields:
        fields["secret"] = (fields["secret"] or "").strip() or None
    fields["include_yaml"] = bool(fields.get("include_yaml", hook.include_yaml)) and kind == "generic"
    for key, value in fields.items():
        setattr(hook, key, value)
    await db.commit()
    await db.refresh(hook)
    latest = await _last_deliveries(db, [hook.id])
    return _out(hook, latest.get(hook.id))


@router.delete("/api/webhooks/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(webhook_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    hook = await _require_hook(db, webhook_id, user)
    await db.execute(delete(WebhookDelivery).where(WebhookDelivery.webhook_id == hook.id))
    await db.delete(hook)
    await db.commit()


@router.post("/api/webhooks/{webhook_id}/test", response_model=WebhookDeliveryOut)
async def test_webhook(
    webhook_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    task_id: uuid.UUID | None = None,
) -> WebhookDelivery:
    """手动投一条测试，看接收端通不通。

    带 `task_id` 时发的是真实任务的全套数据（接收方可以照它把解析逻辑先写好）；
    不带就是一条最小的 ping —— 大多数时候只是想验一下地址和密钥。
    """
    hook = await _require_hook(db, webhook_id, user)
    if task_id is None:
        payload = await build_payload(
            db, "ping", hook.id, hook.include_yaml and hook.kind == "generic"
        )
    else:
        task = await db.get(TestTask, task_id)
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
        if task.team_id != hook.team_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "这个任务不属于该 webhook 的测试团队")
        payload = await task_ping_payload(
            db, task, hook.include_yaml and hook.kind == "generic"
        )

    delivery = WebhookDelivery(webhook_id=hook.id, event="ping", payload=payload)
    db.add(delivery)
    await db.commit()
    await db.refresh(delivery)
    return delivery


@router.get("/api/webhooks/{webhook_id}/deliveries", response_model=list[WebhookDeliveryOut])
async def list_deliveries(
    webhook_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=30, le=200),
) -> list[WebhookDelivery]:
    await _require_hook(db, webhook_id, user)
    rows = (
        await db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.webhook_id == webhook_id)
            .order_by(WebhookDelivery.created_at.desc())
            .limit(limit)
        )
    ).scalars()
    return list(rows)


@router.post("/api/webhooks/{webhook_id}/deliveries/{delivery_id}/redeliver")
async def redeliver(
    webhook_id: uuid.UUID, delivery_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> dict[str, str]:
    """重发一次：把原 payload 原样放回队列（同一份字节，签名照旧有效）。"""
    await _require_hook(db, webhook_id, user)
    delivery = await db.get(WebhookDelivery, delivery_id)
    if delivery is None or delivery.webhook_id != webhook_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "投递记录不存在")
    await db.execute(
        update(WebhookDelivery)
        .where(WebhookDelivery.id == delivery_id)
        .values(
            status="pending",
            attempts=0,
            next_attempt_at=datetime.now(UTC),
            error=None,
            response_status=None,
            response_snippet=None,
            finished_at=None,
        )
    )
    await db.commit()
    return {"status": "queued"}
