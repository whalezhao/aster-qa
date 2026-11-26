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
    CaseFlowNodeOut,
    CaseFlowRunIn,
    CaseFlowSummaryOut,
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
    nodes = list(dict.fromkeys(body.nodes))
    if not nodes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "编排至少需要一个用例")

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
            .where(TestCase.id.in_(nodes))
        )
    ).all()
    found = {row[0] for row in rows}
    if missing := set(nodes) - found:
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
    errors = validate_graph(nodes, edges, names)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "；".join(errors))
    return nodes, edges, names


async def _replace_graph(
    db, flow_id: uuid.UUID, nodes: list[uuid.UUID], edges: list[tuple[uuid.UUID, uuid.UUID]]
) -> None:
    await db.execute(delete(CaseFlowEdge).where(CaseFlowEdge.flow_id == flow_id))
    await db.execute(delete(CaseFlowNode).where(CaseFlowNode.flow_id == flow_id))
    await db.flush()
    for position, case_id in enumerate(nodes):
        db.add(CaseFlowNode(flow_id=flow_id, case_id=case_id, position=position))
    await db.flush()
    for case_id, depends_on in edges:
        db.add(
            CaseFlowEdge(
                flow_id=flow_id, case_id=case_id, depends_on_case_id=depends_on
            )
        )
    await db.flush()


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
            depends_on=depends.get(node.case_id, []),
        )
        for node, case, feature in rows
    ]
    return nodes, edges


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