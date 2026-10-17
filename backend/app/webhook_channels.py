"""企业 IM 渠道的 payload 渲染与业务错误识别。

入队时存的是通用事件 payload；发送时才按渠道渲染，重试仍然发同一份事件事实。
"""

import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode, urlparse, urlunparse

MAX_CHARS = 3500


def _data(payload: dict) -> dict:
    return payload.get("data") or {}


def _sum_runs(data: dict) -> tuple[int, int, int]:
    runs = data.get("runs") or []
    total = sum(int(r.get("total") or 0) for r in runs)
    passed = sum(int(r.get("passed") or 0) for r in runs)
    failed = sum(int(r.get("failed") or 0) for r in runs)
    return total, passed, failed


def event_headline(event: str, payload: dict) -> str:
    data = _data(payload)
    if event == "ping":
        return data.get("message") or "Aster QA 测试消息"
    if event in {"batch.completed", "quality_gate.failed"}:
        batch = data.get("batch") or {}
        name = batch.get("name") or "未命名批次"
        total, passed, failed = _sum_runs(data)
        line = f"执行完成：{name} · 通过 {passed}/{total} · 失败 {failed}"
        if event == "quality_gate.failed":
            reasons = "；".join((data.get("gate") or {}).get("reasons") or [])
            return f"质量门禁未通过：{name}" + (f" · {reasons}" if reasons else "")
        return line
    if event == "batch.assessed":
        assessment = data.get("assessment") or {}
        return f"AI 评估：{assessment.get('verdict') or '完成'} · {assessment.get('headline') or ''}"
    if event == "task.signed":
        task = data.get("task") or {}
        signoff = data.get("signoff") or {}
        who = (signoff.get("signed_by") or {}).get("username") or "有人"
        return f"任务已签名：{task.get('name') or ''} · {who}"
    if event == "schedule.failed":
        schedule = data.get("schedule") or {}
        task = data.get("task") or {}
        return f"定时执行失败：{task.get('name') or ''} · {schedule.get('error') or ''}"
    if event == "model.unhealthy":
        project = data.get("project") or {}
        health = data.get("health") or {}
        return f"模型不可用：{project.get('name') or ''} · {health.get('message') or ''}"
    return f"Aster QA 事件：{event}"


def _text(event: str, payload: dict) -> str:
    headline = event_headline(event, payload)
    data = _data(payload)
    lines = [f"**{headline}**"]
    if event in {"batch.completed", "quality_gate.failed"}:
        batch = data.get("batch") or {}
        if batch.get("trigger"):
            lines.append(f"触发方式：{batch['trigger']}")
        reasons = (data.get("gate") or {}).get("reasons") or []
        if event == "quality_gate.failed" and reasons:
            lines.append("门禁原因：")
            lines.extend(f"- {r}" for r in reasons)
    elif event == "batch.assessed":
        assessment = data.get("assessment") or {}
        for reason in (assessment.get("reasons") or [])[:5]:
            lines.append(f"- {reason}")
        for advice in (assessment.get("advice") or [])[:5]:
            lines.append(f"建议：{advice}")
    elif event == "model.unhealthy":
        health = _data(payload).get("health") or {}
        if health.get("checked_at"):
            lines.append(f"检测时间：{health['checked_at']}")
    elif event == "schedule.failed":
        error = (_data(payload).get("schedule") or {}).get("error")
        if error:
            lines.append(f"错误：{error}")
    text = "\n".join(lines)
    return text[:MAX_CHARS]


def _sign_dingtalk(secret: str) -> dict[str, str]:
    timestamp = str(round(time.time() * 1000))
    string_to_sign = f"{timestamp}\n{secret}".encode()
    digest = hmac.new(secret.encode(), string_to_sign, hashlib.sha256).digest()
    return {"timestamp": timestamp, "sign": base64.b64encode(digest).decode()}


def _sign_feishu(secret: str) -> dict[str, str]:
    timestamp = str(round(time.time()))
    string_to_sign = f"{timestamp}\n{secret}".encode()
    digest = hmac.new(string_to_sign, b"", hashlib.sha256).digest()
    return {"timestamp": timestamp, "sign": base64.b64encode(digest).decode()}


def _append_query(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    query = parsed.query
    extra = urlencode(params)
    query = f"{query}&{extra}" if query else extra
    return urlunparse(parsed._replace(query=query))


def render_provider_request(
    kind: str, url: str, secret: str | None, event: str, payload: dict
) -> tuple[str, bytes, dict[str, str]] | None:
    """返回 (最终 URL, body, headers)；generic 返回 None，走原来的 HMAC 逻辑。"""
    if kind == "generic":
        return None
    text = _text(event, payload)
    headers = {"Content-Type": "application/json", "User-Agent": "aster-qa-notify/1"}
    final_url = url

    if kind == "wecom":
        body = {"msgtype": "markdown", "markdown": {"content": text}}
    elif kind == "dingtalk":
        body = {
            "msgtype": "markdown",
            "markdown": {"title": event_headline(event, payload), "text": text},
        }
        if secret:
            final_url = _append_query(url, _sign_dingtalk(secret))
    elif kind == "feishu":
        body = {"msg_type": "text", "content": {"text": text}}
        if secret:
            body.update(_sign_feishu(secret))
    elif kind == "slack":
        body = {"text": text}
    else:
        raise ValueError(f"未知通知渠道：{kind}")

    return (
        final_url,
        json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(),
        headers,
    )


def provider_business_error(kind: str, status_code: int, text: str) -> str | None:
    """企业 IM 经常 HTTP 200 但 body 里是错误码，必须单独识别。"""
    if kind == "generic" or not (200 <= status_code < 300):
        return None
    try:
        doc = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return None
    if kind in {"wecom", "dingtalk"}:
        code = doc.get("errcode")
        if code not in (None, 0, "0"):
            return f"渠道返回错误 {code}：{doc.get('errmsg') or ''}"[:300]
    elif kind == "feishu":
        code = doc.get("code")
        if code not in (None, 0, "0"):
            return f"渠道返回错误 {code}：{doc.get('msg') or ''}"[:300]
    elif kind == "slack" and doc.get("ok") is False:
        return f"Slack 返回错误：{doc.get('error') or ''}"[:300]
    return None
