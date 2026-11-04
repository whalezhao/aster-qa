"""任务执行相关路由：手动执行、按功能批量回归。"""

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession, require_team_role
from ..models import Feature, Project, Tag, TaskTag, TestCase, TestTask
from ..schemas import RegressionCreate, TaskRunIn
from .task_common import attach_features, check_iteration, require_task, spawn_runs

router = APIRouter(tags=["tasks"])


# --------------------------------------------------------------------------- 执行


@router.post("/api/tasks/{task_id}/run")
async def run_task(
    task_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    body: TaskRunIn | None = None,
) -> dict:
    task = await require_task(db, task_id, user)
    if task.status in {"queued", "running"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "该任务已有执行在进行中")
    # 一个环境一条执行记录（批次）：批次是用户视角的一次执行，环境不同就是两件事
    names: list[str | None] = []
    for name in (body.environment_names if body else []):
        cleaned = name.strip()
        if cleaned and cleaned not in names:
            names.append(cleaned)
    batches = []
    for env_name in names or [None]:
        batch, runs = await spawn_runs(
            db, task, user, trigger="manual", environment_name=env_name
        )
        batches.append(
            {
                "batch_id": str(batch.id),
                "environment_name": batch.environment_name,
                "run_ids": [str(r.id) for r in runs],
            }
        )
    await db.commit()
    return {
        "task_id": str(task.id),
        "batch_id": batches[0]["batch_id"],
        "run_ids": batches[0]["run_ids"],
        "batches": batches,
    }


@router.post(
    "/api/teams/{team_id}/regression-tasks", status_code=status.HTTP_201_CREATED
)
async def create_regression(
    team_id: uuid.UUID, body: RegressionCreate, user: CurrentUser, db: DbSession
) -> dict:
    """多选功能触发回归。

    正式功能和迭代中的功能都能选（需求就是「两者多选」），以用户勾选为准，不按 stage 过滤。
    """
    await require_team_role(team_id, user, db, "member")

    features = list(
        (
            await db.execute(select(Feature).where(Feature.id.in_(body.feature_ids)))
        ).scalars()
    )
    found = {f.id for f in features}
    if missing := set(body.feature_ids) - found:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{len(missing)} 个功能不存在")

    # 跨团队回归会引入权限与配额歧义，直接拒绝
    project_ids = {f.project_id for f in features}
    projects = list(
        (await db.execute(select(Project).where(Project.id.in_(project_ids)))).scalars()
    )
    if any(p.team_id != team_id for p in projects):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "所选功能必须都属于同一个测试团队")

    # 用例集合在这里**快照**下来：保证历史回归可复现，功能后续新增的用例
    # 不会偷偷混进一个已经定稿的回归计划里
    cases = (
        await db.execute(
            select(TestCase.id, TestCase.feature_id).where(
                TestCase.feature_id.in_(body.feature_ids), TestCase.is_active.is_(True)
            )
        )
    ).all()
    if not cases:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "所选功能下没有启用中的用例")

    # 标签若指定了迭代版本，任务的迭代默认取它；显式传入的优先
    iteration_id = body.iteration_id
    if iteration_id is None and body.tag_ids:
        tag_iteration = (
            await db.execute(
                select(Tag.iteration_id)
                .where(Tag.id.in_(body.tag_ids), Tag.iteration_id.is_not(None))
                .limit(1)
            )
        ).scalar_one_or_none()
        if tag_iteration is not None:
            iteration_id = tag_iteration
            await check_iteration(db, iteration_id, team_id)

    task = TestTask(
        team_id=team_id,
        # 跨项目时为 NULL，project_id 下沉到各个 run 上
        project_id=projects[0].id if len(projects) == 1 else None,
        name=body.name,
        type="feature_regression",
        iteration_id=iteration_id,
        retry_count=body.retry_count,
        case_selection_mode="snapshot",
        created_by=user.id,
        status="draft",
    )
    db.add(task)
    await db.flush()

    await attach_features(db, task, body.feature_ids)

    for tag_id in body.tag_ids:
        tag = await db.get(Tag, tag_id)
        if tag is None or tag.team_id != team_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "标签不存在或不属于该测试团队")
        db.add(TaskTag(task_id=task.id, tag_id=tag_id))

    run_ids: list[str] = []
    batch_id: str | None = None
    if body.run_now:
        batch, runs = await spawn_runs(db, task, user, trigger="regression")
        batch_id = str(batch.id)
        run_ids = [str(r.id) for r in runs]

    await db.commit()
    return {
        "task_id": str(task.id),
        "batch_id": batch_id,
        "case_count": len(cases),
        "feature_count": len(body.feature_ids),
        "run_ids": run_ids,
    }
