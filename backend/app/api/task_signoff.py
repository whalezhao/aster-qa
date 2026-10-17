"""任务的人工签名：签名、撤回、查询。"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession, require_team_role
from ..models import TaskSignoff, User
from ..schemas import SignoffIn, SignoffInfo, TaskSignoffOut, UserOut
from ..webhook import case_set_hash, enqueue
from .task_common import require_task

router = APIRouter(tags=["tasks"])


# --------------------------------------------------------------------------- 人工签名


async def _active_signoff(db, task_id: uuid.UUID) -> TaskSignoff | None:
    return (
        await db.execute(
            select(TaskSignoff)
            .where(TaskSignoff.task_id == task_id, TaskSignoff.revoked_at.is_(None))
            .order_by(TaskSignoff.signed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _signoff_view(db, task_id: uuid.UUID) -> TaskSignoffOut:
    row = await _active_signoff(db, task_id)
    current_hash, current_count = await case_set_hash(db, task_id)
    info = None
    if row is not None:
        signer = await db.get(User, row.signed_by) if row.signed_by else None
        info = SignoffInfo(
            id=row.id,
            case_hash=row.case_hash,
            case_count=row.case_count,
            note=row.note,
            signed_at=row.signed_at,
            signed_by=UserOut.model_validate(signer) if signer else None,
        )
    return TaskSignoffOut(
        signed=row is not None,
        # 任务里的用例是按引用存的、内容不冻结，所以签名之后只要有人用了例，
        # 指纹就对不上 —— 这时签名不能再当作有效
        stale=bool(row is not None and row.case_hash != current_hash),
        current_case_count=current_count,
        signoff=info,
    )


@router.get("/api/tasks/{task_id}/signoff", response_model=TaskSignoffOut)
async def get_signoff(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TaskSignoffOut:
    await require_task(db, task_id, user)
    return await _signoff_view(db, task_id)


@router.post("/api/tasks/{task_id}/signoff", response_model=TaskSignoffOut)
async def sign_task(
    task_id: uuid.UUID, body: SignoffIn, user: CurrentUser, db: DbSession
) -> TaskSignoffOut:
    """人工签名：把「谁、何时、审的是哪版用例」钉下来。

    只收团队管理员 —— 签名是替团队背书，不是随手点个赞。
    """
    task = await require_task(db, task_id, user)
    await require_team_role(task.team_id, user, db, "admin")

    case_hash, case_count = await case_set_hash(db, task_id)
    if case_count == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "这个任务还没有用例，没什么可签的")

    # 重新签名 = 撤回旧的 + 记一条新的：历史留着，不覆盖
    now = datetime.now(UTC)
    for old in (
        await db.execute(
            select(TaskSignoff).where(
                TaskSignoff.task_id == task_id, TaskSignoff.revoked_at.is_(None)
            )
        )
    ).scalars():
        old.revoked_at = now
        old.revoked_by = user.id

    db.add(
        TaskSignoff(
            task_id=task_id,
            case_hash=case_hash,
            case_count=case_count,
            note=body.note,
            signed_by=user.id,
        )
    )
    await db.flush()
    # 投给订阅了 task.signed 的 webhook —— 只入队，不在这里等发送
    await enqueue(db, team_id=task.team_id, event="task.signed", ref_id=task_id)
    await db.commit()
    return await _signoff_view(db, task_id)


@router.post("/api/tasks/{task_id}/signoff/revoke", response_model=TaskSignoffOut)
async def revoke_signoff(
    task_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> TaskSignoffOut:
    """撤回签名。不删记录 —— 撤回过这件事本身也要留痕。"""
    task = await require_task(db, task_id, user)
    await require_team_role(task.team_id, user, db, "admin")
    row = await _active_signoff(db, task_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "当前没有生效的签名")
    row.revoked_at = datetime.now(UTC)
    row.revoked_by = user.id
    await db.commit()
    return await _signoff_view(db, task_id)
