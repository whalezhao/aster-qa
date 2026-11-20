"""功能树的纯逻辑与薄查询。

功能量按系统算很小（几十个），所以统一一次载入内存遍历，不用递归 CTE。
所有遍历都带 visited，线上出现脏环也不会死循环。
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import select

from .models import Feature


def descendant_ids(
    parent_of: dict[uuid.UUID, uuid.UUID | None], roots: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    """选中节点 + 全部后代；roots 里不存在的 id 直接忽略。"""
    children: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for fid, pid in parent_of.items():
        if pid is not None:
            children[pid].add(fid)

    result: set[uuid.UUID] = set()
    stack = [root for root in roots if root in parent_of]
    while stack:
        fid = stack.pop()
        if fid in result:
            continue
        result.add(fid)
        stack.extend(children.get(fid, ()))
    return result


def would_cycle(
    parent_of: dict[uuid.UUID, uuid.UUID | None],
    fid: uuid.UUID,
    new_parent: uuid.UUID,
) -> bool:
    """把 fid 挂到 new_parent 下是否会形成环。"""
    current: uuid.UUID | None = new_parent
    seen: set[uuid.UUID] = set()
    while current is not None and current not in seen:
        if current == fid:
            return True
        seen.add(current)
        current = parent_of.get(current)
    return False


def path_of(
    parent_of: dict[uuid.UUID, uuid.UUID | None],
    names: dict[uuid.UUID, str],
    fid: uuid.UUID,
) -> list[str]:
    """根 → 当前节点的名称路径。"""
    path: list[str] = []
    seen: set[uuid.UUID] = set()
    current: uuid.UUID | None = fid
    while current is not None and current not in seen:
        seen.add(current)
        path.append(names.get(current, str(current)))
        current = parent_of.get(current)
    return list(reversed(path))


async def expand_ids(db, ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """把勾选的功能展开成「自身 + 全部后代」。"""
    wanted = set(ids)
    if not wanted:
        return set()
    project_ids = set(
        (
            await db.execute(
                select(Feature.project_id).where(Feature.id.in_(wanted))
            )
        ).scalars()
    )
    if not project_ids:
        return set()
    rows = (
        await db.execute(
            select(Feature.id, Feature.parent_id).where(
                Feature.project_id.in_(project_ids)
            )
        )
    ).all()
    return descendant_ids(dict(rows), wanted)


async def path_map(db, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    """批量算功能路径，给任务详情的功能/用例展示用。"""
    wanted = set(ids)
    if not wanted:
        return {}
    project_ids = set(
        (
            await db.execute(
                select(Feature.project_id).where(Feature.id.in_(wanted))
            )
        ).scalars()
    )
    if not project_ids:
        return {}
    rows = (
        await db.execute(
            select(Feature.id, Feature.parent_id, Feature.name).where(
                Feature.project_id.in_(project_ids)
            )
        )
    ).all()
    parent_of = {fid: pid for fid, pid, _ in rows}
    names = {fid: name for fid, _, name in rows}
    return {
        fid: path_of(parent_of, names, fid)
        for fid in wanted
        if fid in parent_of
    }