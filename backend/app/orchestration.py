"""用例编排的纯逻辑：图校验、分层、执行成功判定。

这里不碰数据库，方便单测；API 层负责把用例/名称查出来再调用。
"""

from __future__ import annotations

import uuid
from collections import defaultdict, deque
from collections.abc import Iterable, Mapping

MAX_FLOW_NODES = 200

TERMINAL_RUN_STATUSES = frozenset(
    {"succeeded", "failed", "cancelled", "timed_out", "blocked"}
)

_STATUS_TEXT = {
    "failed": "执行失败",
    "blocked": "被阻塞",
    "cancelled": "已取消",
    "timed_out": "执行超时",
}


def _label(node_id: uuid.UUID, names: Mapping[uuid.UUID, str] | None) -> str:
    if names and node_id in names:
        return names[node_id]
    return str(node_id)[:8]


def _adjacency(
    node_ids: Iterable[uuid.UUID],
    edges: Iterable[tuple[uuid.UUID, uuid.UUID]],
) -> tuple[set[uuid.UUID], dict[uuid.UUID, set[uuid.UUID]], dict[uuid.UUID, int]]:
    nodes = set(node_ids)
    adjacency: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    indegree = {node: 0 for node in nodes}
    for case_id, depends_on in edges:
        if case_id not in nodes or depends_on not in nodes:
            continue
        if case_id == depends_on or case_id in adjacency[depends_on]:
            continue
        adjacency[depends_on].add(case_id)
        indegree[case_id] += 1
    return nodes, adjacency, indegree


def _cycle_path(
    nodes: set[uuid.UUID],
    adjacency: dict[uuid.UUID, set[uuid.UUID]],
    names: Mapping[uuid.UUID, str] | None,
) -> str:
    color = {node: 0 for node in nodes}
    stack: list[uuid.UUID] = []

    def visit(node: uuid.UUID) -> list[uuid.UUID] | None:
        color[node] = 1
        stack.append(node)
        for nxt in sorted(adjacency[node], key=str):
            if color[nxt] == 1:
                start = stack.index(nxt)
                return stack[start:] + [nxt]
            if color[nxt] == 0:
                found = visit(nxt)
                if found:
                    return found
        stack.pop()
        color[node] = 2
        return None

    for node in sorted(nodes, key=str):
        if color[node] == 0:
            found = visit(node)
            if found:
                return " → ".join(_label(item, names) for item in found)
    return "存在循环依赖"


def validate_graph(
    node_ids: Iterable[uuid.UUID],
    edges: Iterable[tuple[uuid.UUID, uuid.UUID]],
    names: Mapping[uuid.UUID, str] | None = None,
) -> list[str]:
    """校验编排图；返回给用户看的错误列表，空列表表示通过。

    edges 方向是 (case_id, depends_on_case_id)，即 case_id 依赖 depends_on_case_id。
    """
    nodes = set(node_ids)
    errors: list[str] = []
    if len(nodes) > MAX_FLOW_NODES:
        errors.append(f"编排最多支持 {MAX_FLOW_NODES} 个用例")

    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for case_id, depends_on in edges:
        if case_id == depends_on:
            errors.append(f"用例「{_label(case_id, names)}」不能依赖自己")
        elif case_id not in nodes or depends_on not in nodes:
            errors.append(
                f"依赖「{_label(case_id, names)} → {_label(depends_on, names)}」"
                "的两端必须都在编排里"
            )
        elif (case_id, depends_on) in seen:
            errors.append(
                f"依赖「{_label(case_id, names)} → {_label(depends_on, names)}」重复"
            )
        seen.add((case_id, depends_on))

    if errors:
        return errors

    _, adjacency, indegree = _adjacency(nodes, edges)
    queue = deque(sorted((node for node in nodes if indegree[node] == 0), key=str))
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for nxt in sorted(adjacency[node], key=str):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    if visited != len(nodes):
        errors.append(f"编排存在循环依赖：{_cycle_path(nodes, adjacency, names)}")
    return errors


def dag_layers(
    node_ids: Iterable[uuid.UUID],
    edges: Iterable[tuple[uuid.UUID, uuid.UUID]],
) -> list[list[uuid.UUID]]:
    """按最长路径分层；同一层没有依赖关系，可以并行。图有环时抛 ValueError。"""
    nodes, adjacency, indegree = _adjacency(node_ids, edges)
    queue = deque(sorted((node for node in nodes if indegree[node] == 0), key=str))
    layers: list[list[uuid.UUID]] = []
    visited = 0
    while queue:
        layer = list(queue)
        queue.clear()
        layers.append(layer)
        for node in layer:
            visited += 1
            for nxt in sorted(adjacency[node], key=str):
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
    if visited != len(nodes):
        raise ValueError("编排存在循环依赖")
    return layers


def node_succeeded(run) -> bool:
    """前置 run 必须「进程成功且用例没有失败、至少通过一个」。

    run 可以是 ORM 对象，也可以是带同样属性的普通对象。
    """
    return (
        getattr(run, "status", None) == "succeeded"
        and (getattr(run, "failed", 0) or 0) == 0
        and (getattr(run, "passed", 0) or 0) >= 1
    )


def blocked_reason(predecessor_name: str, status: str) -> str:
    text = (
        f"前置用例「{predecessor_name}」"
        f"{_STATUS_TEXT.get(status, '未通过')}，本用例未执行"
    )
    return text[:255]