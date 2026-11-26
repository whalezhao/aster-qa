"""可复用的用例编排（Case Flow）与任务级依赖快照。"""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, func, select

from ..deps import CurrentUser, DbSession, require_project_access
from ..models import (
    CaseFlow,
    CaseFlowEdge,
    CaseFlowNode,
    CaseFlowVersion,
    Feature,
    Project,
    TaskCaseDependency,
    TestCase,
    TestTask,
)
from ..orchestration import dag_layers, validate_graph
from ..schemas import (
    CaseFlowDetailOut,
    CaseFlowEdgeIn,
    CaseFlowIn,
    CaseFlowNodeIn,
    CaseFlowNodeOut,
    CaseFlowRunIn,
    CaseFlowSummaryOut,
    CaseFlowVersionDetailOut,
    CaseFlowVersionOut,
    FlowConditionIn,
    TaskDependenciesIn,
    TaskDependenciesOut,
    TaskDependencyIn,
    TaskFlowApplyIn,
)
from .task_common import (
    merge_flow_into_task,
    replace_task_dependencies,
    require_task,
    spawn_runs,
)

router = APIRouter(tags=["case-flows"])


async def _flow_access(db, flow_id: uuid.UUID, user, minimum: str = "member") -> CaseFlow:
    flow = await db.get(CaseFlow, flow_id)
    if flow is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "编排不存在")
    await require_project_access(db, flow.project_id, user, minimum)
    return flow


async def _validate_flow_input(db, project_id: uuid.UUID, body: CaseFlowIn):
    node_map: dict[uuid.UUID, CaseFlowNodeIn] = {}
    for node in body.nodes:
        node_map.setdefault(node.case_id, node)
    nodes = list(node_map.values())
    if not nodes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "编排至少需要一个用例")

    case_ids = [node.case_id for node in nodes]
    rows = (
        await db.execute(
            select(
                TestCase.id,
                TestCase.name,
                TestCase.is_active,
                Feature.id,
                Feature.name,
                Feature.project_id,
            )
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(TestCase.id.in_(case_ids))
        )
    ).all()
    found = {row[0] for row in rows}
    if missing := set(case_ids) - found:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{len(missing)} 个用例不存在"
        )
    inactive = [row[1] for row in rows if not row[2]]
    if inactive:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"用例已停用：{'、'.join(inactive[:5])}"
        )
    wrong_project = [row[1] for row in rows if row[5] != project_id]
    if wrong_project:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"用例不属于当前系统：{'、'.join(wrong_project[:5])}",
        )

    names = {row[0]: row[1] for row in rows}
    edges = [(edge.case_id, edge.depends_on_case_id) for edge in body.edges]
    errors = validate_graph(case_ids, edges, names)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "；".join(errors))
    parents = {case_id for case_id, _depends_on in edges}
    if any(
        node.condition is not None and node.case_id not in parents
        for node in nodes
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "条件节点必须有至少一个前置节点；否则条件没有可用的流程变量",
        )
    return nodes, edges, names


async def _replace_graph(
    db,
    flow_id: uuid.UUID,
    nodes: list[CaseFlowNodeIn],
    edges: list[tuple[uuid.UUID, uuid.UUID]],
) -> None:
    await db.execute(delete(CaseFlowEdge).where(CaseFlowEdge.flow_id == flow_id))
    await db.execute(delete(CaseFlowNode).where(CaseFlowNode.flow_id == flow_id))
    await db.flush()
    for position, node in enumerate(nodes):
        db.add(
            CaseFlowNode(
                flow_id=flow_id,
                case_id=node.case_id,
                position=position,
                position_x=node.x,
                position_y=node.y,
                condition=node.condition.model_dump() if node.condition else None,
                repeat_count=node.repeat_count,
            )
        )
    await db.flush()
    for case_id, depends_on in edges:
        db.add(
            CaseFlowEdge(
                flow_id=flow_id, case_id=case_id, depends_on_case_id=depends_on
            )
        )
    await db.flush()


async def _snapshot_flow(
    db,
    flow: CaseFlow,
    nodes: list[CaseFlowNodeIn],
    edges: list[tuple[uuid.UUID, uuid.UUID]],
    *,
    source: str,
    note: str | None = None,
    user_id: uuid.UUID | None = None,
) -> CaseFlowVersion:
    if source == "create":
        flow.current_version_no = 1
    else:
        flow.current_version_no = int(flow.current_version_no or 0) + 1
    version = CaseFlowVersion(
        flow_id=flow.id,
        version_no=flow.current_version_no,
        name=flow.name,
        description=flow.description,
        nodes=[
            {
                "case_id": str(node.case_id),
                "position": position,
                "x": node.x,
                "y": node.y,
                "condition": (
                    node.condition.model_dump() if node.condition else None
                ),
                "repeat_count": node.repeat_count,
            }
            for position, node in enumerate(nodes)
        ],
        edges=[
            {
                "case_id": str(case_id),
                "depends_on_case_id": str(depends_on),
            }
            for case_id, depends_on in edges
        ],
        change_source=source,
        change_note=note,
        created_by=user_id,
    )
    db.add(version)
    await db.flush()
    return version


async def _summary(db, flow: CaseFlow) -> CaseFlowSummaryOut:
    node_count = (
        await db.execute(
            select(func.count())
            .select_from(CaseFlowNode)
            .where(CaseFlowNode.flow_id == flow.id)
        )
    ).scalar_one()
    edge_count = (
        await db.execute(
            select(func.count())
            .select_from(CaseFlowEdge)
            .where(CaseFlowEdge.flow_id == flow.id)
        )
    ).scalar_one()
    return CaseFlowSummaryOut(
        id=flow.id,
        project_id=flow.project_id,
        name=flow.name,
        description=flow.description,
        node_count=node_count,
        edge_count=edge_count,
        current_version_no=flow.current_version_no,
        updated_at=flow.updated_at,
    )


async def _check_name(
    db, project_id: uuid.UUID, name: str, exclude_id: uuid.UUID | None = None
) -> None:
    stmt = select(CaseFlow.id).where(
        CaseFlow.project_id == project_id, CaseFlow.name == name
    )
    if exclude_id is not None:
        stmt = stmt.where(CaseFlow.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "同名编排已存在")


@router.get(
    "/api/projects/{project_id}/case-flows",
    response_model=list[CaseFlowSummaryOut],
)
async def list_flows(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[CaseFlowSummaryOut]:
    await require_project_access(db, project_id, user)
    flows = list(
        (
            await db.execute(
                select(CaseFlow)
                .where(CaseFlow.project_id == project_id)
                .order_by(CaseFlow.name)
            )
        ).scalars()
    )
    if not flows:
        return []
    ids = [flow.id for flow in flows]
    node_counts = dict(
        (
            await db.execute(
                select(CaseFlowNode.flow_id, func.count())
                .where(CaseFlowNode.flow_id.in_(ids))
                .group_by(CaseFlowNode.flow_id)
            )
        ).all()
    )
    edge_counts = dict(
        (
            await db.execute(
                select(CaseFlowEdge.flow_id, func.count())
                .where(CaseFlowEdge.flow_id.in_(ids))
                .group_by(CaseFlowEdge.flow_id)
            )
        ).all()
    )
    return [
        CaseFlowSummaryOut(
            id=flow.id,
            project_id=flow.project_id,
            name=flow.name,
            description=flow.description,
            node_count=node_counts.get(flow.id, 0),
            edge_count=edge_counts.get(flow.id, 0),
            updated_at=flow.updated_at,
        )
        for flow in flows
    ]


@router.post(
    "/api/projects/{project_id}/case-flows",
    response_model=CaseFlowSummaryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_flow(
    project_id: uuid.UUID,
    body: CaseFlowIn,
    user: CurrentUser,
    db: DbSession,
) -> CaseFlowSummaryOut:
    await require_project_access(db, project_id, user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名称不能为空")
    await _check_name(db, project_id, name)
    nodes, edges, _ = await _validate_flow_input(db, project_id, body)

    flow = CaseFlow(
        project_id=project_id,
        name=name,
        description=body.description,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(flow)
    await db.flush()
    await _replace_graph(db, flow.id, nodes, edges)
    await _snapshot_flow(
        db, flow, nodes, edges, source="create", user_id=user.id
    )
    await db.commit()
    await db.refresh(flow)
    return await _summary(db, flow)


@router.get("/api/case-flows/{flow_id}", response_model=CaseFlowDetailOut)
async def get_flow(
    flow_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> CaseFlowDetailOut:
    flow = await _flow_access(db, flow_id, user)
    nodes, edges = await _load_detail(db, flow.id)
    return CaseFlowDetailOut(
        id=flow.id,
        project_id=flow.project_id,
        name=flow.name,
        description=flow.description,
        current_version_no=flow.current_version_no,
        nodes=nodes,
        edges=[
            CaseFlowEdgeIn(case_id=case_id, depends_on_case_id=depends_on)
            for case_id, depends_on in edges
        ],
        layers=dag_layers([node.case_id for node in nodes], edges),
    )


async def _load_detail(db, flow_id: uuid.UUID):
    rows = (
        await db.execute(
            select(CaseFlowNode, TestCase, Feature)
            .join(TestCase, TestCase.id == CaseFlowNode.case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(CaseFlowNode.flow_id == flow_id)
            .order_by(CaseFlowNode.position, TestCase.name)
        )
    ).all()
    edges = [
        (row[0], row[1])
        for row in (
            await db.execute(
                select(CaseFlowEdge.case_id, CaseFlowEdge.depends_on_case_id).where(
                    CaseFlowEdge.flow_id == flow_id
                )
            )
        ).all()
    ]
    depends: dict[uuid.UUID, list[uuid.UUID]] = {}
    for case_id, depends_on in edges:
        depends.setdefault(case_id, []).append(depends_on)
    nodes = [
        CaseFlowNodeOut(
            case_id=node.case_id,
            name=case.name,
            feature_id=feature.id,
            feature_name=feature.name,
            priority=case.priority,
            position=node.position,
            x=node.position_x,
            y=node.position_y,
            condition=node.condition,
            repeat_count=node.repeat_count,
            depends_on=depends.get(node.case_id, []),
        )
        for node, case, feature in rows
    ]
    return nodes, edges


def _version_nodes(version: CaseFlowVersion) -> list[CaseFlowNodeIn]:
    return [
        CaseFlowNodeIn(
            case_id=uuid.UUID(str(item["case_id"])),
            x=item.get("x"),
            y=item.get("y"),
            condition=(
                FlowConditionIn(**item["condition"])
                if item.get("condition")
                else None
            ),
            repeat_count=int(item.get("repeat_count") or 1),
        )
        for item in (version.nodes or [])
    ]


def _version_edges(version: CaseFlowVersion) -> list[CaseFlowEdgeIn]:
    return [
        CaseFlowEdgeIn(
            case_id=uuid.UUID(str(item["case_id"])),
            depends_on_case_id=uuid.UUID(str(item["depends_on_case_id"])),
        )
        for item in (version.edges or [])
    ]


@router.get(
    "/api/case-flows/{flow_id}/versions",
    response_model=list[CaseFlowVersionOut],
)
async def list_flow_versions(
    flow_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[CaseFlowVersionOut]:
    await _flow_access(db, flow_id, user)
    versions = list(
        (
            await db.execute(
                select(CaseFlowVersion)
                .where(CaseFlowVersion.flow_id == flow_id)
                .order_by(CaseFlowVersion.version_no.desc())
            )
        ).scalars()
    )
    return [
        CaseFlowVersionOut(
            version_no=version.version_no,
            name=version.name,
            change_source=version.change_source,
            change_note=version.change_note,
            created_at=version.created_at,
            node_count=len(version.nodes or []),
            edge_count=len(version.edges or []),
        )
        for version in versions
    ]


@router.get(
    "/api/case-flows/{flow_id}/versions/{version_no}",
    response_model=CaseFlowVersionDetailOut,
)
async def get_flow_version(
    flow_id: uuid.UUID,
    version_no: int,
    user: CurrentUser,
    db: DbSession,
) -> CaseFlowVersionDetailOut:
    await _flow_access(db, flow_id, user)
    version = (
        await db.execute(
            select(CaseFlowVersion).where(
                CaseFlowVersion.flow_id == flow_id,
                CaseFlowVersion.version_no == version_no,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "编排版本不存在")
    return CaseFlowVersionDetailOut(
        version_no=version.version_no,
        name=version.name,
        description=version.description,
        nodes=_version_nodes(version),
        edges=_version_edges(version),
        change_source=version.change_source,
        change_note=version.change_note,
        created_at=version.created_at,
    )


@router.post(
    "/api/case-flows/{flow_id}/rollback/{version_no}",
    response_model=CaseFlowSummaryOut,
)
async def rollback_flow(
    flow_id: uuid.UUID,
    version_no: int,
    user: CurrentUser,
    db: DbSession,
) -> CaseFlowSummaryOut:
    flow = await _flow_access(db, flow_id, user)
    version = (
        await db.execute(
            select(CaseFlowVersion).where(
                CaseFlowVersion.flow_id == flow_id,
                CaseFlowVersion.version_no == version_no,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "编排版本不存在")

    await _check_name(db, flow.project_id, version.name, exclude_id=flow.id)
    body = CaseFlowIn(
        name=version.name,
        description=version.description,
        nodes=_version_nodes(version),
        edges=_version_edges(version),
    )
    nodes, edges, _ = await _validate_flow_input(db, flow.project_id, body)
    flow.name = version.name
    flow.description = version.description
    flow.updated_by = user.id
    await _replace_graph(db, flow.id, nodes, edges)
    await _snapshot_flow(
        db,
        flow,
        nodes,
        edges,
        source="rollback",
        note=f"回滚到 v{version_no}",
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(flow)
    return await _summary(db, flow)


@router.put("/api/case-flows/{flow_id}", response_model=CaseFlowSummaryOut)
async def update_flow(
    flow_id: uuid.UUID,
    body: CaseFlowIn,
    user: CurrentUser,
    db: DbSession,
) -> CaseFlowSummaryOut:
    flow = await _flow_access(db, flow_id, user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名称不能为空")
    await _check_name(db, flow.project_id, name, exclude_id=flow.id)
    nodes, edges, _ = await _validate_flow_input(db, flow.project_id, body)

    flow.name = name
    flow.description = body.description
    flow.updated_by = user.id
    await _replace_graph(db, flow.id, nodes, edges)
    await _snapshot_flow(
        db, flow, nodes, edges, source="manual", user_id=user.id
    )
    await db.commit()
    await db.refresh(flow)
    return await _summary(db, flow)


@router.delete("/api/case-flows/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flow(
    flow_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> None:
    flow = await _flow_access(db, flow_id, user, "admin")
    await db.delete(flow)
    await db.commit()


@router.post("/api/case-flows/{flow_id}/run")
async def run_flow(
    flow_id: uuid.UUID,
    body: CaseFlowRunIn,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    """直接运行编排：建一个 adhoc 任务再走普通任务执行链路。"""
    flow = await _flow_access(db, flow_id, user)
    project = await db.get(Project, flow.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "编排所属系统不存在")

    task = TestTask(
        team_id=project.team_id,
        project_id=flow.project_id,
        name=f"{flow.name} · {datetime.now().strftime('%m-%d %H:%M')}"[:128],
        type="adhoc",
        status="draft",
        case_selection_mode="snapshot",
        created_by=user.id,
    )
    db.add(task)
    await db.flush()
    await merge_flow_into_task(db, task, flow)

    batches = []
    for environment_name in body.environment_names or [None]:
        batch, runs = await spawn_runs(
            db, task, user, trigger="manual", environment_name=environment_name
        )
        batches.append(
            {
                "batch_id": str(batch.id),
                "environment_name": batch.environment_name,
                "run_ids": [str(run.id) for run in runs],
            }
        )
    await db.commit()
    return {"task_id": str(task.id), "batches": batches}


@router.post("/api/tasks/{task_id}/apply-flow")
async def apply_flow(
    task_id: uuid.UUID,
    body: TaskFlowApplyIn,
    user: CurrentUser,
    db: DbSession,
) -> dict[str, int]:
    task = await require_task(db, task_id, user)
    flow = await _flow_access(db, body.flow_id, user)
    project = await db.get(Project, flow.project_id)
    if project is None or project.team_id != task.team_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "编排不属于该测试团队")

    added_cases, added_edges = await merge_flow_into_task(
        db, task, flow, replace_dependencies=body.replace_dependencies
    )
    await db.commit()
    case_count = (
        await db.execute(
            select(func.count())
            .select_from(TaskCaseDependency)
            .where(TaskCaseDependency.task_id == task.id)
        )
    ).scalar_one()
    return {
        "added_cases": added_cases,
        "added_edges": added_edges,
        "dependency_count": case_count,
    }


@router.get(
    "/api/tasks/{task_id}/case-dependencies",
    response_model=TaskDependenciesOut,
)
async def get_task_dependencies(
    task_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> TaskDependenciesOut:
    await require_task(db, task_id, user)
    rows = (
        await db.execute(
            select(
                TaskCaseDependency.case_id,
                TaskCaseDependency.depends_on_case_id,
            ).where(TaskCaseDependency.task_id == task_id)
        )
    ).all()
    return TaskDependenciesOut(
        dependencies=[
            TaskDependencyIn(case_id=case_id, depends_on_case_id=depends_on)
            for case_id, depends_on in rows
        ]
    )


@router.put(
    "/api/tasks/{task_id}/case-dependencies",
    response_model=TaskDependenciesOut,
)
async def set_task_dependencies(
    task_id: uuid.UUID,
    body: TaskDependenciesIn,
    user: CurrentUser,
    db: DbSession,
) -> TaskDependenciesOut:
    task = await require_task(db, task_id, user)
    edges = [
        (item.case_id, item.depends_on_case_id) for item in body.dependencies
    ]
    await replace_task_dependencies(db, task, edges)
    await db.commit()
    return TaskDependenciesOut(dependencies=body.dependencies)