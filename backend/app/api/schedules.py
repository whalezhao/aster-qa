"""任务定时计划。"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import TaskSchedule
from ..scheduler import compute_next_run, validate_schedule
from ..schemas import ScheduleIn, ScheduleOut
from .task_common import require_task

router = APIRouter(tags=["schedules"])


@router.get("/api/tasks/{task_id}/schedule", response_model=ScheduleOut | None)
async def get_schedule(
    task_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> TaskSchedule | None:
    await require_task(db, task_id, user)
    return (
        await db.execute(select(TaskSchedule).where(TaskSchedule.task_id == task_id))
    ).scalar_one_or_none()


@router.put("/api/tasks/{task_id}/schedule", response_model=ScheduleOut)
async def set_schedule(
    task_id: uuid.UUID, body: ScheduleIn, user: CurrentUser, db: DbSession
) -> TaskSchedule:
    task = await require_task(db, task_id, user, "admin")
    try:
        cron, timezone = validate_schedule(body.cron, body.timezone)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    row = (
        await db.execute(select(TaskSchedule).where(TaskSchedule.task_id == task.id))
    ).scalar_one_or_none()
    if row is None:
        row = TaskSchedule(task_id=task.id, created_by=user.id)
        db.add(row)
    row.cron = cron
    row.timezone = timezone
    row.enabled = body.enabled
    row.next_run_at = (
        compute_next_run(cron, timezone, base=datetime.now(UTC)) if body.enabled else None
    )
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/api/tasks/{task_id}/schedule", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    task_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    await require_task(db, task_id, user, "admin")
    row = (
        await db.execute(select(TaskSchedule).where(TaskSchedule.task_id == task_id))
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
