"""任务定时回归。

调度循环放在 API 进程里：认领用行锁 + 条件推进 next_run_at，即使多个 API 副本
同时轮询也只会有一个真正触发。错过的时点不补跑，下一次从当前时间重新算。
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .api.task_common import active_task_ids, spawn_runs
from .config import get_settings
from .db import SessionLocal
from .models import TaskSchedule, TestTask

log = logging.getLogger("scheduler")


def validate_schedule(cron: str, timezone: str) -> tuple[str, str]:
    cron = (cron or "").strip()
    timezone = (timezone or "").strip() or "Asia/Shanghai"
    if len(cron.split()) != 5:
        raise ValueError("cron 需要 5 段：分 时 日 月 周")
    if not croniter.is_valid(cron):
        raise ValueError("cron 表达式不合法")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"时区不存在：{timezone}") from exc
    return cron, timezone


def compute_next_run(cron: str, timezone: str, base: datetime | None = None) -> datetime:
    tz = ZoneInfo(timezone)
    local = (base or datetime.now(UTC)).astimezone(tz)
    nxt = croniter(cron, local).get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=tz)
    return nxt.astimezone(UTC)


async def _claim_due(db: AsyncSession) -> list[uuid.UUID]:
    now = datetime.now(UTC)
    rows = list(
        (
            await db.execute(
                select(TaskSchedule)
                .where(
                    TaskSchedule.enabled.is_(True),
                    TaskSchedule.next_run_at.is_not(None),
                    TaskSchedule.next_run_at <= now,
                )
                .order_by(TaskSchedule.next_run_at)
                .limit(10)
                .with_for_update(skip_locked=True)
            )
        ).scalars()
    )
    for row in rows:
        # 先推进时间再执行：即使进程在 spawn 前崩了，也不会在同一分钟反复触发
        row.next_run_at = compute_next_run(row.cron, row.timezone, base=now)
    return [row.id for row in rows]


async def _dispatch(schedule_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        schedule = await db.get(TaskSchedule, schedule_id)
        if schedule is None or not schedule.enabled:
            return
        task = await db.get(TestTask, schedule.task_id)
        if task is None:
            await db.delete(schedule)
            await db.commit()
            return

        active = await active_task_ids(db, [task.id])
        if active:
            schedule.last_status = "skipped_overlap"
            schedule.overlap_skipped += 1
            schedule.last_run_at = datetime.now(UTC)
            await db.commit()
            return

        team_id = task.team_id
        try:
            batch, _runs = await spawn_runs(
                db,
                task,
                None,
                trigger="schedule",
                created_by_id=schedule.created_by or task.created_by,
            )
            schedule.last_status = "queued"
            schedule.last_batch_id = batch.id
            schedule.last_run_at = datetime.now(UTC)
            schedule.last_error = None
            await db.commit()
        except Exception as exc:
            log.exception("scheduled run failed for task %s", task.id)
            await db.rollback()
            schedule = await db.get(TaskSchedule, schedule_id)
            if schedule is not None:
                schedule.last_status = "failed"
                schedule.last_run_at = datetime.now(UTC)
                schedule.last_error = str(exc)[:2000]
            try:
                from .webhook import enqueue

                await enqueue(
                    db, team_id=team_id, event="schedule.failed", ref_id=schedule_id
                )
            except Exception:
                log.exception("enqueue schedule.failed failed")
            await db.commit()


async def run_due_schedules() -> int:
    async with SessionLocal() as db:
        due = await _claim_due(db)
        await db.commit()
    for schedule_id in due:
        await _dispatch(schedule_id)
    return len(due)


async def scheduler_loop() -> None:
    settings = get_settings()
    while True:
        try:
            await run_due_schedules()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("scheduler iteration failed")
        await asyncio.sleep(max(5, settings.scheduler_poll_seconds))
