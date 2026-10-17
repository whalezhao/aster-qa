"""项目级 AI token 限额。

当月用量 = 两部分相加：
1. 执行器消耗：`ai_calls` 里属于该项目、本月启动的 run 的 token；
2. 平台侧消耗：`ai_token_usage` 流水（生成用例 / 执行评估 / 预检 / 团队复盘）。

限额存在 `project_model_configs.token_quota`，NULL 或 <=0 表示不限。
超限后不再发起新的执行、也不再调模型做生成/评估 —— 报错里带已用/限额，
管理员调高限额即可，比账单失控好。
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AiCall, AiTokenUsage, ProjectModelConfig, Run


def month_start(now: datetime | None = None) -> datetime:
    current = now or datetime.now(UTC)
    return current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def project_month_usage(db: AsyncSession, project_id: uuid.UUID) -> int:
    """该项目本自然月已消耗的 token（执行器 + 平台侧）。"""
    runner = (
        await db.execute(
            select(func.coalesce(func.sum(AiCall.total_tokens), 0))
            .join(Run, Run.id == AiCall.run_id)
            .where(
                Run.project_id == project_id,
                Run.started_at >= month_start(),
            )
        )
    ).scalar_one()
    platform = (
        await db.execute(
            select(func.coalesce(func.sum(AiTokenUsage.tokens), 0)).where(
                AiTokenUsage.project_id == project_id,
                AiTokenUsage.created_at >= month_start(),
            )
        )
    ).scalar_one()
    return int(runner) + int(platform)


async def ensure_quota(
    db: AsyncSession, project_id: uuid.UUID, config: ProjectModelConfig | None
) -> None:
    """额度用尽时抛 RuntimeError；调用方决定转成 400 还是让 AI 检查失败。"""
    quota = config.token_quota if config is not None else None
    if not quota or quota <= 0:
        return
    used = await project_month_usage(db, project_id)
    if used >= quota:
        raise RuntimeError(
            f"项目本月 AI token 已用尽（{used:,} / {quota:,}），"
            "请到「项目 → 大模型配置」调高限额，或等下月重置"
        )


async def record_usage(
    db: AsyncSession, project_id: uuid.UUID, source: str, usage: dict | None
) -> int:
    """记一条平台侧 token 流水。返回记了多少 token。"""
    tokens = int((usage or {}).get("total_tokens") or 0)
    if tokens <= 0:
        return 0
    db.add(AiTokenUsage(project_id=project_id, source=source, tokens=tokens))
    return tokens
