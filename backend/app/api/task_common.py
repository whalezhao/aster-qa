"""任务的共享操作：权限、快照、拆 run、删除、产物清理。

放在单独模块是因为「执行」和「签名」两组路由也要用它们 —— 都塞在 tasks.py 里会形成
循环导入，而且那个文件已经近千行。
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, exists, func, select, update

from ..config import get_settings
from ..deps import require_team_role
from ..environments import DEFAULT_ENVIRONMENT, resolve_run_environments
from ..feature_tree import expand_ids
from ..modelconfig import assert_projects_configured
from ..models import (
    AiCheck,
    AppSetting,
    CaseFlow,
    CaseFlowEdge,
    CaseFlowNode,
    CaseResult,
    Feature,
    Iteration,
    Project,
    ProjectModelConfig,
    Run,
    RunBatch,
    RunDependency,
    TaskCase,
    TaskCaseDependency,
    TaskFeature,
    TestCase,
    TestCaseVersion,
    TestTask,
)
from ..orchestration import validate_graph
from ..quota import ensure_quota
from ..runner import staging
from ..taskstatus import ACTIVE_RUN_STATUSES


async def require_task(db, task_id: uuid.UUID, user, minimum: str = "member") -> TestTask:
    task = await db.get(TestTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    await require_team_role(task.team_id, user, db, minimum)
    return task


def task_manage_role(task, user) -> str:
    """编辑/删除任务需要的最低团队角色：创建人只要成员，其他人要管理员。"""
    return "member" if task.created_by == user.id else "admin"


async def require_task_manage(db, task_id: uuid.UUID, user) -> TestTask:
    """任务编辑/删除：创建人本人，或测试团队 owner/admin。"""
    task = await db.get(TestTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "任务不存在")
    await require_team_role(task.team_id, user, db, task_manage_role(task, user))
    return task


async def resolve_run_groups(db, task: TestTask) -> dict[uuid.UUID, int]:
    """任务下的用例按项目分组。

    这不是优化而是硬约束：YAML 里的 gotoUrl / ${BASE_URL} 是项目级的，跨项目的用例
    没法在一次 midscene-test 里跑，所以跨项目的任务必须拆成多个 run。
    """
    stmt = (
        select(Feature.project_id, func.count(TestCase.id))
        .join(TestCase, TestCase.feature_id == Feature.id)
        .join(TaskCase, TaskCase.case_id == TestCase.id)
        .where(TaskCase.task_id == task.id, TestCase.is_active.is_(True))
        .group_by(Feature.project_id)
    )
    return {row[0]: row[1] for row in (await db.execute(stmt)).all()}


async def _cases_by_project(db, task: TestTask) -> dict[uuid.UUID, list[uuid.UUID]]:
    """按系统列出任务快照里的用例 id，顺序沿用任务里的 position。"""
    rows = (
        await db.execute(
            select(Feature.project_id, TestCase.id)
            .join(TestCase, TestCase.feature_id == Feature.id)
            .join(TaskCase, TaskCase.case_id == TestCase.id)
            .where(TaskCase.task_id == task.id, TestCase.is_active.is_(True))
            .order_by(TaskCase.position, TestCase.name)
        )
    ).all()
    grouped: dict[uuid.UUID, list[uuid.UUID]] = {}
    for project_id, case_id in rows:
        grouped.setdefault(project_id, []).append(case_id)
    return grouped


async def _case_plan_by_project(db, task: TestTask) -> dict:
    """按项目拆分编排节点和普通用例；同一条用例只会进其中一组。"""
    rows = (
        await db.execute(
            select(Feature.project_id, TestCase.id, TaskCase.is_flow_node)
            .join(TestCase, TestCase.feature_id == Feature.id)
            .join(TaskCase, TaskCase.case_id == TestCase.id)
            .where(TaskCase.task_id == task.id, TestCase.is_active.is_(True))
            .order_by(TaskCase.position, TestCase.name)
        )
    ).all()
    plan: dict[uuid.UUID, dict[str, list[uuid.UUID]]] = {}
    for project_id, case_id, is_flow_node in rows:
        group = plan.setdefault(project_id, {"flow": [], "free": []})
        group["flow" if is_flow_node else "free"].append(case_id)
    return plan


async def attach_features(
    db,
    task: TestTask,
    feature_ids: list[uuid.UUID],
    case_ids: list[uuid.UUID] | None = None,
) -> tuple[int, int]:
    """把功能、以及它们下面启用中的用例，**快照**进任务。返回 (用例数, 功能数)。

    勾选父功能时先展开成「自身 + 全部后代」：TaskFeature 存覆盖闭包，
    TaskCase 存闭包里所有启用用例，source_feature_id 仍是用例真实所属功能。
    case_ids 用于只勾单条用例；其所属功能也会进 TaskFeature，保证任务详情能看到。
    两者同时传时按用例 id 去重。

    快照而非动态引用：保证历史回归可复现 —— 功能后续新增的用例不会偷偷混进
    一个已经定稿的回归计划里。
    """
    expanded = await expand_ids(db, feature_ids)
    if not expanded and not case_ids:
        return 0, 0
    rows: list[tuple[uuid.UUID, uuid.UUID]] = []
    if expanded:
        rows = (
            await db.execute(
                select(TestCase.id, TestCase.feature_id)
                .join(Feature, Feature.id == TestCase.feature_id)
                .where(
                    TestCase.feature_id.in_(expanded), TestCase.is_active.is_(True)
                )
                .order_by(Feature.name, TestCase.name)
            )
        ).all()
    if case_ids:
        rows.extend(
            (
                await db.execute(
                    select(TestCase.id, TestCase.feature_id).where(
                        TestCase.id.in_(case_ids), TestCase.is_active.is_(True)
                    )
                )
            ).all()
        )
    seen: set[uuid.UUID] = set()
    cases: list[tuple[uuid.UUID, uuid.UUID]] = []
    for case_id, feature_id in rows:
        if case_id in seen:
            continue
        seen.add(case_id)
        cases.append((case_id, feature_id))
    feature_set = set(expanded) | {feature_id for _, feature_id in cases}
    for feature_id in sorted(feature_set, key=str):
        db.add(TaskFeature(task_id=task.id, feature_id=feature_id))
    for position, (case_id, feature_id) in enumerate(cases):
        db.add(
            TaskCase(
                task_id=task.id,
                case_id=case_id,
                source_feature_id=feature_id,
                position=position,
            )
        )
    return len(cases), len(feature_set)


async def task_case_meta(db, task_id: uuid.UUID):
    """任务用例的 id/位置/编排标记/用例名/启用状态/所属项目。"""
    return (
        await db.execute(
            select(
                TaskCase.case_id,
                TaskCase.position,
                TaskCase.is_flow_node,
                TestCase.name,
                TestCase.is_active,
                Feature.project_id,
                TaskCase.condition,
                TaskCase.repeat_count,
            )
            .join(TestCase, TestCase.id == TaskCase.case_id)
            .join(Feature, Feature.id == TestCase.feature_id)
            .where(TaskCase.task_id == task_id)
        )
    ).all()


async def validate_task_edges(
    db, task_id: uuid.UUID, edges: list[tuple[uuid.UUID, uuid.UUID]]
) -> list[str]:
    rows = await task_case_meta(db, task_id)
    ids = {row[0] for row in rows}
    names = {row[0]: row[3] for row in rows}
    active = {row[0]: row[4] for row in rows}
    projects = {row[0]: row[5] for row in rows}

    errors = validate_graph(ids, edges, names)
    for case_id, depends_on in edges:
        if case_id in active and not active[case_id]:
            errors.append(f"用例「{names[case_id]}」已停用")
        if depends_on in active and not active[depends_on]:
            errors.append(f"用例「{names[depends_on]}」已停用")
        if (
            case_id in projects
            and depends_on in projects
            and projects[case_id] != projects[depends_on]
        ):
            errors.append("依赖的两端必须属于同一个系统")
    return errors


async def load_flow_graph(db, flow_id: uuid.UUID):
    nodes = (
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
    return nodes, edges


async def merge_flow_into_task(
    db, task: TestTask, flow: CaseFlow, *, replace_dependencies: bool = False
) -> tuple[int, int]:
    """把流程的节点/边合并进任务；返回 (新增用例数, 新增边数)。"""
    if task.status in {"queued", "running"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "任务正在执行，无法修改编排")

    nodes, flow_edges = await load_flow_graph(db, flow.id)
    if not nodes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "编排里还没有用例")
    inactive = [case.name for _, case, _ in nodes if not case.is_active]
    if inactive:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"编排里的用例已停用：{'、'.join(inactive[:5])}",
        )

    existing = {row[0]: row for row in await task_case_meta(db, task.id)}
    features = set(
        (
            await db.execute(
                select(TaskFeature.feature_id).where(TaskFeature.task_id == task.id)
            )
        ).scalars()
    )
    max_position = max((row[1] for row in existing.values()), default=-1)

    added_cases = 0
    for node, case, feature in nodes:
        if node.case_id in existing:
            await db.execute(
                update(TaskCase)
                .where(
                    TaskCase.task_id == task.id, TaskCase.case_id == node.case_id
                )
                .values(
                    is_flow_node=True,
                    condition=node.condition,
                    repeat_count=node.repeat_count,
                )
            )
        else:
            max_position += 1
            db.add(
                TaskCase(
                    task_id=task.id,
                    case_id=node.case_id,
                    source_feature_id=feature.id,
                    position=max_position,
                    is_flow_node=True,
                    condition=node.condition,
                    repeat_count=node.repeat_count,
                )
            )
            added_cases += 1
        if feature.id not in features:
            db.add(TaskFeature(task_id=task.id, feature_id=feature.id))
            features.add(feature.id)

    if replace_dependencies:
        await db.execute(
            delete(TaskCaseDependency).where(TaskCaseDependency.task_id == task.id)
        )
        existing_edges: set[tuple[uuid.UUID, uuid.UUID]] = set()
    else:
        existing_edges = {
            (row[0], row[1])
            for row in (
                await db.execute(
                    select(
                        TaskCaseDependency.case_id,
                        TaskCaseDependency.depends_on_case_id,
                    ).where(TaskCaseDependency.task_id == task.id)
                )
            ).all()
        }

    added_edges = 0
    for case_id, depends_on in flow_edges:
        if (case_id, depends_on) not in existing_edges:
            db.add(
                TaskCaseDependency(
                    task_id=task.id,
                    case_id=case_id,
                    depends_on_case_id=depends_on,
                )
            )
            added_edges += 1

    await db.flush()
    errors = await validate_task_edges(
        db, task.id, list(existing_edges | set(flow_edges))
    )
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "；".join(errors))
    return added_cases, added_edges


async def replace_task_dependencies(
    db, task: TestTask, edges: list[tuple[uuid.UUID, uuid.UUID]]
) -> None:
    if task.status in {"queued", "running"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "任务正在执行，无法修改编排")
    errors = await validate_task_edges(db, task.id, edges)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "；".join(errors))

    await db.execute(
        delete(TaskCaseDependency).where(TaskCaseDependency.task_id == task.id)
    )
    for case_id, depends_on in edges:
        db.add(
            TaskCaseDependency(
                task_id=task.id,
                case_id=case_id,
                depends_on_case_id=depends_on,
            )
        )
    if edges:
        involved = {case_id for edge in edges for case_id in edge}
        await db.execute(
            update(TaskCase)
            .where(TaskCase.task_id == task.id, TaskCase.case_id.in_(involved))
            .values(is_flow_node=True)
        )
    await db.flush()


def split_shards(case_ids: list[uuid.UUID], shard_size: int) -> list[list[uuid.UUID]]:
    """按 shard_size 切分用例；0 表示不分片。"""
    if not case_ids:
        return []
    if shard_size <= 0:
        return [case_ids]
    return [
        case_ids[index : index + shard_size]
        for index in range(0, len(case_ids), shard_size)
    ]


async def _ensure_base_url_available(
    db, environments: dict, cases_by_project: dict[uuid.UUID, list[uuid.UUID]]
) -> None:
    """用例引用 ${BASE_URL} 时，环境或项目必须给得出地址。

    否则 midscene 在收集阶段就报 Undefined project variable，整批用例一条都不跑；
    拦在入队前，用户才能看到一句能照着改的提示。
    """
    project_ids = set(cases_by_project)
    projects = {
        row.id: row
        for row in (
            await db.execute(select(Project).where(Project.id.in_(project_ids)))
        ).scalars()
    }
    case_ids = [cid for ids in cases_by_project.values() for cid in ids]
    yaml_by_id = dict(
        (
            await db.execute(
                select(TestCase.id, TestCase.yaml_content).where(TestCase.id.in_(case_ids))
            )
        ).all()
    )

    problems: list[str] = []
    for project_id, ids in cases_by_project.items():
        env = environments.get(project_id)
        project = projects.get(project_id)
        effective = (env.base_url if env is not None else None) or (
            project.base_url if project is not None else None
        )
        if effective:
            continue
        if any("${BASE_URL}" in (yaml_by_id.get(cid) or "") for cid in ids):
            project_name = project.name if project is not None else str(project_id)
            env_name = env.name if env is not None else DEFAULT_ENVIRONMENT
            problems.append(f"系统「{project_name}」的环境「{env_name}」没有配置被测地址")
    if problems:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "；".join(problems)
            + "，但用例里引用了 ${BASE_URL}；请到系统环境里补上地址后再执行",
        )


async def spawn_runs(
    db,
    task: TestTask,
    user=None,
    trigger: str = "manual",
    *,
    case_ids: list[uuid.UUID] | None = None,
    parent_batch_id: uuid.UUID | None = None,
    environment_name: str | None = None,
    created_by_id: uuid.UUID | None = None,
    created_by_token_id: uuid.UUID | None = None,
) -> tuple[RunBatch, list[Run]]:
    """为一次执行建批次，并按项目拆出多个 run。

    批次是用户视角的「一次执行」，run 是技术粒度（一次 midscene 进程只能跑一个项目）。
    `case_ids` 用于「只重跑失败用例」：只跑指定用例，仍然按项目拆 run。
    """
    plan = await _case_plan_by_project(db, task)
    if case_ids is not None:
        wanted = set(case_ids)
        plan = {
            project_id: {
                "flow": [cid for cid in group["flow"] if cid in wanted],
                "free": [cid for cid in group["free"] if cid in wanted],
            }
            for project_id, group in plan.items()
        }
        plan = {
            pid: group
            for pid, group in plan.items()
            if group["flow"] or group["free"]
        }

    task_dependencies = [
        (row[0], row[1])
        for row in (
            await db.execute(
                select(
                    TaskCaseDependency.case_id,
                    TaskCaseDependency.depends_on_case_id,
                ).where(TaskCaseDependency.task_id == task.id)
            )
        ).all()
    ]
    edge_ids = {case_id for edge in task_dependencies for case_id in edge}
    # 标记可能因为历史数据/手工改库没刷新；边上的用例一律按编排节点执行
    for group in plan.values():
        moved = [cid for cid in group["free"] if cid in edge_ids]
        if moved:
            group["free"] = [cid for cid in group["free"] if cid not in edge_ids]
            group["flow"].extend(moved)

    cases_by_project = {
        project_id: group["flow"] + group["free"]
        for project_id, group in plan.items()
        if group["flow"] or group["free"]
    }
    groups = {pid: len(ids) for pid, ids in cases_by_project.items()}
    if not groups:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "任务下没有可执行的用例")
    if case_ids is None:
        executable = {cid for ids in cases_by_project.values() for cid in ids}
        if edge_ids - executable:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "编排引用的用例已停用或删除；请重新编辑编排后再执行",
            )
    # 执行门禁：项目必须明确配过模型才允许跑。所有执行路径都汇到这里，拦一处就够。
    await assert_projects_configured(db, set(groups))
    # 额度门禁：超限就不让跑 —— 报错里带已用/限额，管理员调高即可
    for project_id in groups:
        try:
            await ensure_quota(
                db, project_id, await db.get(ProjectModelConfig, project_id)
            )
        except RuntimeError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    env_name = (environment_name or task.environment_name or "").strip() or DEFAULT_ENVIRONMENT
    try:
        environments = await resolve_run_environments(
            db, task, set(groups), environment_name=env_name
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await _ensure_base_url_available(db, environments, cases_by_project)

    batch = RunBatch(
        task_id=task.id,
        team_id=task.team_id,
        iteration_id=task.iteration_id,
        # 存任务名快照：任务改名或删除后历史记录还要能显示
        name=task.name,
        trigger=trigger,
        parent_batch_id=parent_batch_id,
        environment_name=env_name,
        created_by=user.id if user else created_by_id,
        created_by_token_id=created_by_token_id,
    )
    db.add(batch)
    await db.flush()

    settings = await db.get(AppSetting, 1)
    shard_size = max(0, int(settings.run_shard_size if settings else 4))

    meta_rows = await task_case_meta(db, task.id)
    flow_meta = {
        row[0]: {"condition": row[6], "repeat_count": row[7]} for row in meta_rows
    }

    runs: list[Run] = []
    flow_run_by_case: dict[uuid.UUID, Run] = {}
    flow_runs_by_case: dict[uuid.UUID, list[Run]] = {}
    for project_id in sorted(groups, key=str):
        group = plan[project_id]
        env = environments[project_id]
        # 编排节点：一个用例一个 run（固定循环展开成多个串行 run），run 之间用
        # RunDependency 门禁。下游依赖的是循环的最后一个 run。
        for case_id in group["flow"]:
            meta = flow_meta.get(case_id, {})
            condition = meta.get("condition")
            repeat = max(1, min(20, int(meta.get("repeat_count") or 1)))
            has_predecessor = any(
                child == case_id for child, _ in task_dependencies
            )
            iteration_runs: list[Run] = []
            for iteration in range(repeat):
                iteration_condition = condition if iteration == 0 else None
                run = Run(
                    task_id=task.id,
                    batch_id=batch.id,
                    team_id=task.team_id,
                    project_id=project_id,
                    iteration_id=task.iteration_id,
                    environment_id=env.id,
                    environment_name=env.name,
                    environment_base_url=env.base_url,
                    created_by=user.id if user else created_by_id,
                    status="queued",
                    run_kind="flow",
                    case_ids=[str(case_id)],
                    flow_inputs_ready=iteration == 0 and not has_predecessor,
                    condition=iteration_condition,
                    condition_passed=(
                        False if iteration_condition is not None else None
                    ),
                    loop_index=iteration + 1 if repeat > 1 else None,
                    loop_total=repeat if repeat > 1 else None,
                )
                db.add(run)
                runs.append(run)
                iteration_runs.append(run)
            flow_runs_by_case[case_id] = iteration_runs
            flow_run_by_case[case_id] = iteration_runs[-1]

        # 未编排的用例保持原行为：按 shard_size 切片，每个 run 一个浏览器。
        # case_ids 必须显式落库，否则同一项目里的分片 run 会把编排用例也跑一遍。
        chunks = split_shards(group["free"], shard_size)
        shard_count = len(chunks)
        for chunk_index, chunk in enumerate(chunks):
            run = Run(
                task_id=task.id,
                batch_id=batch.id,
                team_id=task.team_id,
                project_id=project_id,
                iteration_id=task.iteration_id,
                environment_id=env.id,
                environment_name=env.name,
                environment_base_url=env.base_url,
                created_by=user.id if user else created_by_id,
                status="queued",
                run_kind="shard",
                case_ids=[str(case_id) for case_id in chunk],
                shard_index=chunk_index + 1 if shard_count > 1 else None,
                shard_count=shard_count if shard_count > 1 else None,
            )
            db.add(run)
            runs.append(run)
    if not runs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "任务下没有可执行的用例")
    task.status = "queued"
    # flush 才能拿到主键 —— id 的默认值是 Python 侧 uuid4，构造时还没赋值
    await db.flush()

    # 编排节点先绑定最近的版本：即使后面被阻塞，报告里也能显示它是哪一版
    all_flow_runs = [
        run for runs_for_case in flow_runs_by_case.values() for run in runs_for_case
    ]
    if all_flow_runs:
        versions: dict[str, dict] = {}
        version_rows = (
            await db.execute(
                select(
                    TestCaseVersion.case_id,
                    TestCaseVersion.id,
                    TestCaseVersion.version_no,
                )
                .where(TestCaseVersion.case_id.in_(list(flow_runs_by_case)))
                .order_by(TestCaseVersion.case_id, TestCaseVersion.version_no.desc())
            )
        ).all()
        for case_id, version_id, version_no in version_rows:
            versions.setdefault(
                str(case_id),
                {"version_id": str(version_id), "version_no": version_no},
            )
        for run in all_flow_runs:
            case_id = str(run.case_ids[0])
            if case_id in versions:
                run.case_versions = {case_id: versions[case_id]}

    # 只有在本次真正创建的节点之间建边；重跑时被排除的已成功前置自然不再连线
    for case_id, depends_on in task_dependencies:
        children = flow_runs_by_case.get(case_id)
        predecessors = flow_runs_by_case.get(depends_on)
        if children and predecessors:
            db.add(
                RunDependency(
                    run_id=children[0].id,
                    depends_on_run_id=predecessors[-1].id,
                )
            )
    # 固定循环：第 i 次依赖第 i-1 次，输出按顺序传给下一轮
    for runs_for_case in flow_runs_by_case.values():
        for index in range(1, len(runs_for_case)):
            db.add(
                RunDependency(
                    run_id=runs_for_case[index].id,
                    depends_on_run_id=runs_for_case[index - 1].id,
                )
            )
    await db.flush()
    return batch, runs


async def failed_case_ids(
    db, *, batch_id: uuid.UUID | None = None, run_id: uuid.UUID | None = None
) -> tuple[list[uuid.UUID], int]:
    """返回 (可重跑的失败用例 id, 无法归属的失败结果数)。"""
    stmt = (
        select(CaseResult.test_case_id)
        .join(Run, Run.id == CaseResult.run_id)
        .where(
            CaseResult.status.not_in(("success", "passed", "skipped")),
            # 模型/网络/额度导致的失败不重跑：环境没恢复时再跑一遍只会再红一次
            Run.failure_kind.is_(None),
        )
    )
    if batch_id is not None:
        stmt = stmt.where(Run.batch_id == batch_id)
    if run_id is not None:
        stmt = stmt.where(CaseResult.run_id == run_id)
    rows = list((await db.execute(stmt)).scalars())
    # 编排节点在产出结果前就失败/超时（例如浏览器没起来）时没有 CaseResult，
    # 回退到 run 上绑定的单个 case，否则这些节点永远无法重跑。
    flow_conditions = [
        Run.run_kind == "flow",
        Run.status.in_(("failed", "blocked", "timed_out")),
        ~exists(select(CaseResult.id).where(CaseResult.run_id == Run.id)),
    ]
    if batch_id is not None:
        flow_conditions.append(Run.batch_id == batch_id)
    if run_id is not None:
        flow_conditions.append(Run.id == run_id)
    extra: set[uuid.UUID] = set()
    for case_ids in (
        await db.execute(select(Run.case_ids).where(*flow_conditions))
    ).scalars():
        if not case_ids:
            continue
        try:
            extra.add(uuid.UUID(str(case_ids[0])))
        except (TypeError, ValueError):
            continue
    resolvable = sorted(
        {row for row in rows if row is not None} | extra, key=str
    )
    unresolved = sum(1 for row in rows if row is None)
    return resolvable, unresolved


async def delete_tasks(db, tasks: list[TestTask]) -> tuple[list[str], list[str]]:
    """删任务并**连带删掉它的执行记录**，返回待清理的 (工作目录, midscene runId)。

    runs.task_id / run_batches.task_id 的外键是 SET NULL —— 只删任务的话，这些执行
    记录会变成「没有任务归属的残留」，继续占着执行记录页。所以按 task_id 显式清掉；
    case_results / ai_calls 由数据库上的 CASCADE 跟着 run 一起走。
    """
    task_ids = [t.id for t in tasks]
    batch_ids = list(
        (
            await db.execute(select(RunBatch.id).where(RunBatch.task_id.in_(task_ids)))
        ).scalars()
    )
    run_ids = set(
        (await db.execute(select(Run.id).where(Run.task_id.in_(task_ids)))).scalars()
    )
    if batch_ids:
        # 批次下可能还有 task_id 对不上的 run，一并清掉，别留半截批次
        run_ids.update(
            (await db.execute(select(Run.id).where(Run.batch_id.in_(batch_ids)))).scalars()
        )

    dirs: list[str] = []
    midscene_ids: list[str] = []
    if run_ids:
        rows = (
            await db.execute(
                select(Run.work_dir, Run.midscene_run_id).where(Run.id.in_(run_ids))
            )
        ).all()
        dirs = [work_dir for work_dir, _ in rows if work_dir]
        midscene_ids = [mid for _, mid in rows if mid]
        await db.execute(delete(Run).where(Run.id.in_(run_ids)))
    if batch_ids:
        await db.execute(
            delete(AiCheck).where(
                AiCheck.entity_type == "batch", AiCheck.entity_id.in_(batch_ids)
            )
        )
        await db.execute(delete(RunBatch).where(RunBatch.id.in_(batch_ids)))
    await db.execute(
        delete(AiCheck).where(
            AiCheck.entity_type == "task", AiCheck.entity_id.in_(task_ids)
        )
    )
    await db.execute(delete(TestTask).where(TestTask.id.in_(task_ids)))
    return dirs, midscene_ids


def purge_artifacts(dirs: list[str], midscene_ids: list[str]) -> None:
    """删掉执行在本机留下的产物（私有工作目录 + 散落在全局目录的报告）。"""
    staging.purge_run_artifacts(
        runner_root=get_settings().runner_path,
        work_dirs=dirs,
        midscene_run_ids=midscene_ids,
    )


async def active_task_ids(db, task_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """有执行正在排队/跑着的任务 —— 这些不能删：worker 手里还攥着那个 run。"""
    if not task_ids:
        return set()
    return set(
        (
            await db.execute(
                select(Run.task_id)
                .where(
                    Run.task_id.in_(task_ids), Run.status.in_(ACTIVE_RUN_STATUSES)
                )
                .distinct()
            )
        ).scalars()
    )


async def check_iteration(db, iteration_id: uuid.UUID, team_id: uuid.UUID) -> None:
    iteration = await db.get(Iteration, iteration_id)
    if iteration is None or iteration.team_id != team_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "迭代不存在或不属于该测试团队")
