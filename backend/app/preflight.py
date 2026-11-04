"""执行前预检：把「点了执行才失败」的问题提前说清楚。"""

import asyncio
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .api.task_common import resolve_run_groups
from .config import get_settings
from .environments import EnvironmentResolutionError, resolve_run_environments
from .modelconfig import missing_fields
from .models import (
    Project,
    ProjectModelConfig,
    ProjectModelHealth,
    TestTask,
    WorkerHeartbeat,
)
from .quota import project_month_usage

_PROBE_TIMEOUT = 5.0


def _check(
    key: str,
    ok: bool,
    message: str,
    *,
    severity: str = "error",
    overridable: bool = False,
    project_id=None,
    project_name: str | None = None,
) -> dict:
    return {
        "key": key,
        "ok": ok,
        "severity": "ok" if ok else severity,
        "message": message,
        "overridable": overridable,
        "project_id": str(project_id) if project_id else None,
        "project_name": project_name,
    }


def summarize_checks(checks: list[dict]) -> bool:
    """只有「不可覆盖的 error」才阻断执行。"""
    return not any(
        (not c["ok"]) and c["severity"] == "error" and not c["overridable"]
        for c in checks
    )


async def _probe_url(client: httpx.AsyncClient, url: str | None) -> tuple[bool, str]:
    if not url:
        return False, "没有配置被测地址"
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False, "被测地址必须是 http/https URL"
    try:
        # 任何 HTTP 状态都算可达：401/404 说明服务在，只是路径/鉴权不同
        await client.get(url)
        return True, "被测地址可访问"
    except (httpx.HTTPError, OSError) as exc:
        if parsed.hostname in {"127.0.0.1", "localhost", "::1"}:
            return (
                False,
                (
                    "平台侧无法访问 localhost（执行器若使用 host 网络仍可能可达）："
                    f"{type(exc).__name__}"
                ),
            )
        return False, f"被测地址不可访问：{type(exc).__name__}"


async def run_preflight(
    db: AsyncSession, task: TestTask, *, environment_name: str | None = None
) -> dict:
    settings = get_settings()
    project_ids = set(await resolve_run_groups(db, task))
    checks: list[dict] = []
    environment_name = (
        environment_name or task.environment_name or ""
    ).strip() or "默认"

    if not project_ids:
        checks.append(_check("cases", False, "任务下没有可执行的用例"))
        return {
            "checks": checks,
            "can_run": False,
            "environment_name": environment_name,
        }

    checks.append(
        _check("cases", True, f"共 {len(project_ids)} 个系统有待执行用例")
    )

    environments = {}
    try:
        environments = await resolve_run_environments(
            db, task, project_ids, environment_name=environment_name
        )
        checks.append(
            _check("environment", True, f"环境「{environment_name}」在所选系统下都存在")
        )
    except EnvironmentResolutionError as exc:
        checks.append(_check("environment", False, str(exc)))

    project_rows = (
        await db.execute(
            select(Project.id, Project.name, Project.base_url).where(
                Project.id.in_(project_ids)
            )
        )
    ).all()
    project_names = {row.id: row.name for row in project_rows}
    # 与执行时一致：环境没配地址就回落到项目地址
    project_urls = {row.id: row.base_url for row in project_rows}

    # 模型配置完整性
    configs: dict = {}
    for project_id in sorted(project_ids, key=str):
        config = await db.get(ProjectModelConfig, project_id)
        configs[project_id] = config
        gaps = missing_fields(config)
        checks.append(
            _check(
                "model_config",
                not gaps,
                "模型配置完整" if not gaps else f"模型配置还差：{'、'.join(gaps)}",
                project_id=project_id,
                project_name=project_names.get(project_id),
            )
        )

    # 模型健康：用最近一次巡检结果，不在这里额外烧 token
    health_rows = {
        row.project_id: row
        for row in (
            await db.execute(
                select(ProjectModelHealth).where(
                    ProjectModelHealth.project_id.in_(project_ids)
                )
            )
        ).scalars()
    }
    fresh_after = datetime.now(UTC) - timedelta(
        seconds=max(60, settings.model_health_interval_seconds) * 2
    )
    for project_id in sorted(project_ids, key=str):
        row = health_rows.get(project_id)
        name = project_names.get(project_id)
        if row is None or row.checked_at < fresh_after:
            checks.append(
                _check(
                    "model_health",
                    False,
                    "还没有近期的模型连通性记录，可先点「测试连接」",
                    severity="warning",
                    project_id=project_id,
                    project_name=name,
                )
            )
        elif row.status == "healthy":
            checks.append(
                _check(
                    "model_health",
                    True,
                    "模型连通正常",
                    project_id=project_id,
                    project_name=name,
                )
            )
        else:
            checks.append(
                _check(
                    "model_health",
                    False,
                    row.message or "模型健康检查未通过",
                    severity="error",
                    overridable=True,
                    project_id=project_id,
                    project_name=name,
                )
            )

    # 额度
    for project_id in sorted(project_ids, key=str):
        config = configs.get(project_id)
        quota = config.token_quota if config else None
        used = await project_month_usage(db, project_id)
        if quota and quota > 0 and used >= quota:
            checks.append(
                _check(
                    "quota",
                    False,
                    f"本月 token 已用尽（{used:,} / {quota:,}）",
                    project_id=project_id,
                    project_name=project_names.get(project_id),
                )
            )
        else:
            checks.append(
                _check(
                    "quota",
                    True,
                    f"本月已用 {used:,} tokens" + (f" / {quota:,}" if quota else "（不限）"),
                    project_id=project_id,
                    project_name=project_names.get(project_id),
                )
            )

    # 被测地址：并行探测，避免串行等待
    async with httpx.AsyncClient(
        timeout=_PROBE_TIMEOUT, trust_env=False, follow_redirects=False
    ) as client:
        async def probe(project_id):
            env = environments.get(project_id)
            url = (env.base_url if env is not None else None) or project_urls.get(project_id)
            ok, message = await _probe_url(client, url)
            checks.append(
                _check(
                    "base_url",
                    ok,
                    message,
                    severity="warning",
                    overridable=True,
                    project_id=project_id,
                    project_name=project_names.get(project_id),
                )
            )

        await asyncio.gather(*(probe(pid) for pid in sorted(project_ids, key=str)))

    # 执行器在线
    stale_before = datetime.now(UTC) - timedelta(seconds=settings.worker_stale_seconds)
    online = (
        await db.execute(
            select(WorkerHeartbeat.id).where(WorkerHeartbeat.heartbeat_at >= stale_before)
        )
    ).first()
    checks.append(
        _check(
            "worker",
            online is not None,
            "执行器在线" if online is not None else "没有在线的执行器，任务会一直排队",
        )
    )

    return {
        "checks": checks,
        "can_run": summarize_checks(checks),
        "environment_name": environment_name,
    }
