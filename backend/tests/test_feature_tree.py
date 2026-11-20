"""功能树纯逻辑测试（不依赖数据库）。"""

import uuid

from app.feature_tree import descendant_ids, path_of, would_cycle


def _id() -> uuid.UUID:
    return uuid.uuid4()


def test_descendant_ids_walks_the_whole_subtree():
    a, b, c, d = _id(), _id(), _id(), _id()
    parent_of = {a: None, b: a, c: b, d: None}

    assert descendant_ids(parent_of, [a]) == {a, b, c}
    assert descendant_ids(parent_of, [a, d]) == {a, b, c, d}
    assert descendant_ids(parent_of, [b]) == {b, c}
    assert descendant_ids(parent_of, []) == set()
    assert descendant_ids(parent_of, [_id()]) == set()


def test_descendant_ids_does_not_loop_on_dirty_cycle():
    a, b = _id(), _id()
    parent_of = {a: b, b: a}
    assert descendant_ids(parent_of, [a]) == {a, b}


def test_would_cycle():
    a, b, c, d = _id(), _id(), _id(), _id()
    parent_of = {a: None, b: a, c: b, d: None}

    assert would_cycle(parent_of, a, a) is True
    assert would_cycle(parent_of, a, c) is True  # 孙子不能当父
    assert would_cycle(parent_of, a, d) is False
    assert would_cycle(parent_of, c, a) is False


def test_path_of():
    a, b, c = _id(), _id(), _id()
    parent_of = {a: None, b: a, c: b}
    names = {a: "组织中心", b: "法人机构", c: "左侧树验证"}

    assert path_of(parent_of, names, a) == ["组织中心"]
    assert path_of(parent_of, names, c) == ["组织中心", "法人机构", "左侧树验证"]


def test_path_of_does_not_loop_on_dirty_cycle():
    a, b = _id(), _id()
    parent_of = {a: b, b: a}
    names = {a: "A", b: "B"}
    assert path_of(parent_of, names, a) == ["B", "A"]