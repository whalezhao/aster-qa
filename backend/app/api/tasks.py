import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, delete, func, or_, select

from ..deps import CurrentUser, DbSession, get_team_membership, require_team_role, visible_team_ids
from ..models import (
    Feature,
    Project,
    Run,
    RunBatch,
    Tag,
    TaskCase,
    TaskFeature,
    TaskSignoff,
    TaskTag,
    TestCase,
    TestTask,
)
from ..schemas import (
    CaseIdList,
    FeatureIdList,
    TagIdList,
    TaskCreate,
    TaskIdList,
    TaskOut,
    TaskUpdate,
)
from ..taskstatus import aggregate
from .batches import derive_status
from .task_common import (
    active_task_ids,
    attach_features,
    delete_tasks,
    purge_artifacts,
    require_task,
    spawn_runs,
)

router = APIRouter(tags=["tasks"])


async def _enrich_tasks(db, tasks: list[TestTask]) -> list[TaskOut]:
    """给任务列表补上功能数 / 用例数 / 最近一次执行。

    任务粒度的列表要能一眼看出「这个任务组合了什么、最近跑得怎么样」，
    否则还得点进去才知道，列表就失去意义了。
    """
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    feature_counts = dict(
        (
            await db.execute(
                select(TaskFeature.task_id, func.count())
                .where(TaskFeature.task_id.in_(ids))
                .group_by(TaskFeature.task_id)
            )
        ).all()
    )
    case_counts = dict(
        (
            await db.execute(
                select(TaskCase.task_id, func.count())
                .where(TaskCase.task_id.in_(ids))
                .group_by(TaskCase.task_id)
            )
        ).all()
    )

    # 每个任务最近一次批次（PostgreSQL 的 DISTINCT ON，比子查询干净）
    last_batches = (
        await db.execute(
            select(RunBatch.task_id, RunBatch.id, RunBatch.created_at)
            .where(RunBatch.task_id.in_(ids))
            .distinct(RunBatch.task_id)
            .order_by(RunBatch.task_id, RunBatch.created_at.desc())
        )
    ).all()
    batch_by_task = {row[0]: (row[1], row[2]) for row in last_batches}

    # 每个任务当前生效的签名（撤回的不算）
    signoffs = (
        await db.execute(
            select(TaskSignoff.task_id, TaskSignoff.signed_at)
            .where(TaskSignoff.task_id.in_(ids), TaskSignoff.revoked_at.is_(None))
            .distinct(TaskSignoff.task_id)
            .order_by(TaskSignoff.task_id, TaskSignoff.signed_at.desc())
        )
    ).all()
    signoff_by_task = {row[0]: row[1] for row in signoffs}

    batch_status: dict[uuid.UUID, str] = {}
    if batch_by_task:
        agg = (
            await db.execute(
                select(
                    Run.batch_id,
                    func.array_agg(Run.status),
                    func.coalesce(func.sum(Run.failed), 0),
                    func.count(Run.id).filter(Run.failure_kind.is_not(None)),
                    func.coalesce(
                        func.sum(Run.failed).filter(Run.failure_kind.is_not(None)), 0
                    ),
                )
                .where(Run.batch_id.in_([b[0] for b in batch_by_task.values()]))
                .group_by(Run.batch_id)
            )
        ).all()
        batch_status = {
            row[0]: derive_status(
                list(row[1]),
                real_failed=int(row[2]) - int(row[4]),
                excluded_runs=int(row[3]),
            )
            for row in agg
        }

    out: list[TaskOut] = []
    # 自愈：worker 万一在收尾提交前崩掉，任务状态会停在 queued/running 而它的 run 其实
    # 都结束了（历史上真发生过）。发现这种 drift 就顺手纠正 —— 只在真的要改时写库。
    run_status_by_task: dict[uuid.UUID, list[str]] = {}
    for row_task_id, row_status in (
        await db.execute(select(Run.task_id, Run.status).where(Run.task_id.in_(ids)))
    ).all():
        if row_task_id is not None:
            run_status_by_task.setdefault(row_task_id, []).append(row_status)
    repaired = 0
    for task in tasks:
        statuses = run_status_by_task.get(task.id)
        if not statuses or task.status not in {"queued", "running"}:
            continue
        expected = aggregate(statuses)
        if expected != task.status:
            task.status = expected
            repaired += 1
    if repaired:
        await db.commit()

    for task in tasks:
        item = TaskOut.model_validate(task)
        item.feature_count = int(feature_counts.get(task.id, 0))
        item.case_count = int(case_counts.get(task.id, 0))
        if task.id in batch_by_task:
            batch_id, created_at = batch_by_task[task.id]
            item.last_batch_id = batch_id
            item.last_batch_status = batch_status.get(batch_id)
            item.last_run_at = created_at
        if task.id in signoff_by_task:
            item.signed = True
            item.signed_at = signoff_by_task[task.id]
        out.append(item)
    return out


# ------------------------------------------------------------------------- 任务 CRUD


@router.get("/api/teams/{team_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    team_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    project_id: uuid.UUID | None = None,
    stage: str | None = None,
    task_status: str | None = Query(default=None, alias="status"),
    name: str | None = None,
) -> list[TaskOut]:
    """任务粒度的列表。默认支持按项目 / 分期 / 状态 / 名称筛。"""
    await get_team_membership(db, team_id, user)
    stmt = select(TestTask).where(TestTask.team_id == team_id)
    if project_id is not None:
        # 任务可能跨项目（project_id 为 NULL），所以按「它的功能属于该项目」判断
        stmt = stmt.where(
            select(TaskFeature.feature_id)
            .join(Feature, Feature.id == TaskFeature.feature_id)
            .where(
                TaskFeature.task_id == TestTask.id,
                Feature.project_id == project_id,
            )
            .exists()
        )
    if stage:
        # 用例的生效分期是派生的：COALESCE(stage_override, 功能.stage)
        stmt = stmt.where(
            select(TaskCase.case_id)
            .join(TestCase, TestCase.id == TaskCase.case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(
                TaskCase.task_id == TestTask.id,
                or_(
                    TestCase.stage_override == stage,
                    and_(TestCase.stage_override.is_(None), Feature.stage == stage),
                ),
            )
            .exists()
        )
    if task_status:
        stmt = stmt.where(TestTask.status == task_status)
    if name:
        stmt = stmt.where(TestTask.name.ilike(f"%{name}%"))
    stmt = stmt.order_by(TestTask.created_at.desc())
    return await _enrich_tasks(db, list((await db.execute(stmt)).scalars()))


@router.get("/api/tasks", response_model=list[TaskOut])
async def list_my_tasks(user: CurrentUser, db: DbSession) -> list[TaskOut]:
    ids = await visible_team_ids(db, user)
    if not ids:
        return []
    stmt = (
        select(TestTask)
        .where(TestTask.team_id.in_(ids))
        .order_by(TestTask.created_at.desc())
        .limit(200)
    )
    return await _enrich_tasks(db, list((await db.execute(stmt)).scalars()))


@router.post("/api/teams/{team_id}/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    team_id: uuid.UUID, body: TaskCreate, user: CurrentUser, db: DbSession
) -> dict:
    """建任务。可以直接带上要回归的功能，一次调用就把任务建好并（可选）触发执行。"""
    await require_team_role(team_id, user, db, "member")
    if body.type not in {"case_run", "feature_regression", "iteration_regression", "adhoc"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法任务类型")

    features = []
    if body.feature_ids:
        features = list(
            (
                await db.execute(
                    select(Feature)
                    .join(Project, Project.id == Feature.project_id)
                    .where(Feature.id.in_(body.feature_ids), Project.team_id == team_id)
                )
            ).scalars()
        )
        if missing := set(body.feature_ids) - {f.id for f in features}:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{len(missing)} 个功能不存在或不属于该团队"
            )

    project_ids = {f.project_id for f in features}
    if body.project_id is not None:
        project_ids.add(body.project_id)
    projects = list(
        (await db.execute(select(Project).where(Project.id.in_(project_ids)))).scalars()
    )
    if any(p.team_id != team_id for p in projects):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "项目不存在或不属于该团队")

    task = TestTask(
        team_id=team_id,
        created_by=user.id,
        name=body.name,
        type=body.type,
        description=body.description,
        # 跨项目时为 NULL —— project_id 下沉到各个 run 上
        project_id=projects[0].id if len(projects) == 1 else None,
        iteration_id=body.iteration_id,
        retry_count=body.retry_count,
        case_selection_mode="snapshot",
        status="draft",
    )
    db.add(task)
    await db.flush()

    case_count = await attach_features(db, task, body.feature_ids)
    for tag_id in body.tag_ids:
        tag = await db.get(Tag, tag_id)
        if tag is None or tag.team_id != team_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "标签不存在或不属于该团队")
        db.add(TaskTag(task_id=task.id, tag_id=tag_id))

    batch_id: str | None = None
    run_ids: list[str] = []
    if body.run_now:
        batch, runs = await spawn_runs(db, task, user, trigger="manual")
        batch_id = str(batch.id)
        run_ids = [str(r.id) for r in runs]

    await db.commit()
    # 返回完整的任务对象 + 本次建的用例/执行信息，前端一次调用就能拿到全部
    return {
        **TaskOut.model_validate(task).model_dump(mode="json"),
        "case_count": case_count,
        "feature_count": len(features),
        "batch_id": batch_id,
        "run_ids": run_ids,
    }


@router.get("/api/tasks/{task_id}", response_model=TaskOut)
async def get_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TestTask:
    return await require_task(db, task_id, user)


@router.patch("/api/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID, body: TaskUpdate, user: CurrentUser, db: DbSession
) -> TestTask:
    task = await require_task(db, task_id, user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    await db.commit()
    await db.refresh(task)
    return task


@router.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    task = await require_task(db, task_id, user, "admin")
    if task_id in await active_task_ids(db, [task_id]):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "该任务有执行正在进行或排队中，请先取消再删除"
        )
    dirs, midscene_ids = await delete_tasks(db, [task])
    await db.commit()
    purge_artifacts(dirs, midscene_ids)


@router.post("/api/tasks/bulk-delete")
async def bulk_delete_tasks(
    body: TaskIdList, user: CurrentUser, db: DbSession
) -> dict[str, object]:
    """批量删除任务，连带删掉它们的执行记录。

    正在跑的任务跳过而不是整批失败 —— 勾了 10 个删掉 9 个比一个都删不掉有用；
    跳过的会单独报回来，让用户知道是哪几个。
    """
    tasks = list(
        (
            await db.execute(select(TestTask).where(TestTask.id.in_(body.task_ids)))
        ).scalars()
    )
    for task in tasks:
        await require_team_role(task.team_id, user, db, "admin")

    active = await active_task_ids(db, [t.id for t in tasks])
    deletable = [t for t in tasks if t.id not in active]
    dirs, midscene_ids = (
        await delete_tasks(db, deletable) if deletable else ([], [])
    )
    await db.commit()
    purge_artifacts(dirs, midscene_ids)
    return {
        "deleted": len(deletable),
        "skipped": [
            {"id": str(t.id), "name": t.name, "reason": "有执行正在进行或排队中"}
            for t in tasks
            if t.id in active
        ],
    }


# ------------------------------------------------------------- 任务的用例 / 标签 / 功能


@router.get("/api/tasks/{task_id}/cases")
async def list_task_cases(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    await require_task(db, task_id, user)
    stmt = (
        select(TestCase, Feature, TaskCase.source_feature_id)
        .join(TaskCase, TaskCase.case_id == TestCase.id)
        .join(Feature, Feature.id == TestCase.feature_id)
        .where(TaskCase.task_id == task_id)
        .order_by(TaskCase.position, TestCase.name)
    )
    return [
        {
            "id": str(case.id),
            "name": case.name,
            "priority": case.priority,
            "defect_ids": case.defect_ids,
            "is_active": case.is_active,
            "effective_stage": case.stage_override or feature.stage,
            "feature_id": str(feature.id),
            "feature_name": feature.name,
            "feature_requirement_ids": feature.requirement_ids,
            "project_id": str(feature.project_id),
            "source_feature_id": str(source) if source else None,
        }
        for case, feature, source in (await db.execute(stmt)).all()
    ]


@router.put("/api/tasks/{task_id}/cases")
async def set_task_cases(
    task_id: uuid.UUID, body: CaseIdList, user: CurrentUser, db: DbSession
) -> dict[str, int]:
    task = await require_task(db, task_id, user)
    await db.execute(delete(TaskCase).where(TaskCase.task_id == task_id))
    if body.case_ids:
        # 必须连团队一起过滤：只用 id 查会让 A 团队的成员把 B 团队的用例挂到自己
        # 任务上执行，从而读到别人的用例内容
        rows = (
            await db.execute(
                select(TestCase.id, TestCase.feature_id)
                .join(Feature, Feature.id == TestCase.feature_id)
                .join(Project, Project.id == Feature.project_id)
                .where(TestCase.id.in_(body.case_ids), Project.team_id == task.team_id)
            )
        ).all()
        found = {row[0] for row in rows}
        if missing := set(body.case_ids) - found:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{len(missing)} 个用例不存在或不属于该团队"
            )
        for position, (case_id, feature_id) in enumerate(rows):
            db.add(
                TaskCase(
                    task_id=task_id,
                    case_id=case_id,
                    source_feature_id=feature_id,
                    position=position,
                )
            )
    await db.commit()
    return {"count": len(body.case_ids)}


@router.put("/api/tasks/{task_id}/tags")
async def set_task_tags(
    task_id: uuid.UUID, body: TagIdList, user: CurrentUser, db: DbSession
) -> dict[str, int]:
    task = await require_task(db, task_id, user)
    await db.execute(delete(TaskTag).where(TaskTag.task_id == task_id))
    for tag_id in body.tag_ids:
        tag = await db.get(Tag, tag_id)
        if tag is None or tag.team_id != task.team_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "标签不存在或不属于该团队")
        db.add(TaskTag(task_id=task_id, tag_id=tag_id))
    await db.commit()
    return {"count": len(body.tag_ids)}


@router.get("/api/tasks/{task_id}/features")
async def list_task_features(
    task_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[dict]:
    """任务由哪些功能组合而成 —— 任务详情的「功能」页签要用。"""
    await require_task(db, task_id, user)
    stmt = (
        select(Feature, Project.name)
        .join(TaskFeature, TaskFeature.feature_id == Feature.id)
        .join(Project, Project.id == Feature.project_id)
        .where(TaskFeature.task_id == task_id)
        .order_by(Project.name, Feature.name)
    )
    return [
        {
            "id": str(feature.id),
            "name": feature.name,
            "stage": feature.stage,
            "project_id": str(feature.project_id),
            "project_name": project_name,
        }
        for feature, project_name in (await db.execute(stmt)).all()
    ]


@router.put("/api/tasks/{task_id}/features")
async def set_task_features(
    task_id: uuid.UUID, body: FeatureIdList, user: CurrentUser, db: DbSession
) -> dict[str, int]:
    task = await require_task(db, task_id, user)
    await db.execute(delete(TaskFeature).where(TaskFeature.task_id == task_id))
    if body.feature_ids:
        # 同 set_task_cases：必须按团队过滤，否则能挂上别团队的功能
        rows = (
            await db.execute(
                select(Feature.id)
                .join(Project, Project.id == Feature.project_id)
                .where(Feature.id.in_(body.feature_ids), Project.team_id == task.team_id)
            )
        ).scalars()
        found = set(rows)
        if missing := set(body.feature_ids) - found:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{len(missing)} 个功能不存在或不属于该团队"
            )
        for feature_id in body.feature_ids:
            db.add(TaskFeature(task_id=task_id, feature_id=feature_id))
    await db.commit()
    return {"count": len(body.feature_ids)}


@router.get("/api/tasks/{task_id}/tags")
async def list_task_tags(task_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    await require_task(db, task_id, user)
    stmt = select(Tag).join(TaskTag, TaskTag.tag_id == Tag.id).where(TaskTag.task_id == task_id)
    return [
        {"id": str(t.id), "name": t.name, "color": t.color, "iteration_id": str(t.iteration_id) if t.iteration_id else None}
        for t in (await db.execute(stmt)).scalars()
    ]


