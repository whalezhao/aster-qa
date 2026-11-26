import uuid
from types import SimpleNamespace

import pytest

from app.orchestration import (
    MAX_FLOW_NODES,
    blocked_reason,
    condition_reason,
    dag_layers,
    evaluate_condition,
    node_succeeded,
    validate_graph,
)

A = uuid.UUID(int=1)
B = uuid.UUID(int=2)
C = uuid.UUID(int=3)
D = uuid.UUID(int=4)


def test_validate_graph_accepts_chain_diamond_and_isolated_nodes():
    assert validate_graph([A, B], [(B, A)]) == []
    assert validate_graph([A, B, C, D], [(B, A), (C, A), (D, B), (D, C)]) == []
    assert validate_graph([A, B, C], []) == []


def test_validate_graph_rejects_bad_shapes():
    errors = validate_graph([A], [(A, A)])
    assert any("不能依赖自己" in error for error in errors)

    errors = validate_graph([A, B], [(B, A), (B, A)])
    assert any("重复" in error for error in errors)

    errors = validate_graph([A, B], [(B, uuid.UUID(int=99))])
    assert any("两端" in error for error in errors)

    errors = validate_graph(
        [A, B, C], [(B, A), (C, B), (A, C)], {A: "A", B: "B", C: "C"}
    )
    text = " ".join(errors)
    assert "循环依赖" in text
    assert "A" in text and "B" in text and "C" in text


def test_validate_graph_rejects_too_many_nodes():
    nodes = [uuid.UUID(int=i) for i in range(MAX_FLOW_NODES + 1)]
    errors = validate_graph(nodes, [])
    assert any("最多支持" in error for error in errors)


def test_dag_layers_puts_independent_branches_in_the_same_layer():
    layers = dag_layers([A, B, C, D], [(B, A), (C, A), (D, B), (D, C)])
    assert [set(layer) for layer in layers] == [{A}, {B, C}, {D}]

    assert dag_layers([A, B], [(B, A)]) == [[A], [B]]


def test_dag_layers_rejects_cycles():
    with pytest.raises(ValueError):
        dag_layers([A, B], [(B, A), (A, B)])


def test_node_succeeded_requires_case_level_success():
    assert node_succeeded(SimpleNamespace(status="succeeded", failed=0, passed=1))
    assert not node_succeeded(SimpleNamespace(status="succeeded", failed=1, passed=0))
    assert not node_succeeded(SimpleNamespace(status="succeeded", failed=None, passed=None))
    assert not node_succeeded(SimpleNamespace(status="failed", failed=1, passed=0))
    assert not node_succeeded(SimpleNamespace(status="blocked", failed=1, passed=0))


def test_condition_evaluation():
    inputs = {"STATUS": "paid", "AMOUNT": 100, "FLAG": True}
    assert evaluate_condition({"variable": "STATUS", "op": "eq", "value": "paid"}, inputs)
    assert not evaluate_condition(
        {"variable": "STATUS", "op": "eq", "value": "unpaid"}, inputs
    )
    assert evaluate_condition(
        {"variable": "STATUS", "op": "ne", "value": "unpaid"}, inputs
    )
    assert evaluate_condition(
        {"variable": "STATUS", "op": "contains", "value": "ai"}, inputs
    )
    assert evaluate_condition({"variable": "AMOUNT", "op": "gt", "value": 50}, inputs)
    assert evaluate_condition({"variable": "AMOUNT", "op": "lt", "value": 500}, inputs)
    assert not evaluate_condition(
        {"variable": "MISSING", "op": "eq", "value": "x"}, inputs
    )
    assert evaluate_condition(None, inputs)
    assert "条件不满足" in condition_reason(
        {"variable": "STATUS", "op": "eq", "value": "unpaid"}, inputs
    )


def test_flow_condition_schema():
    from pydantic import ValidationError

    from app.schemas import CaseFlowIn, CaseFlowNodeIn, FlowConditionIn

    body = CaseFlowIn(
        name="flow",
        nodes=[
            CaseFlowNodeIn(
                case_id=A,
                condition=FlowConditionIn(
                    variable="STATUS", op="eq", value="paid"
                ),
                repeat_count=3,
            )
        ],
    )
    assert body.nodes[0].condition is not None
    assert body.nodes[0].condition.variable == "STATUS"
    assert body.nodes[0].repeat_count == 3

    try:
        CaseFlowNodeIn(case_id=A, repeat_count=0)
    except ValidationError:
        pass
    else:
        raise AssertionError("repeat_count=0 should be rejected")


def test_blocked_reason_is_human_readable_and_bounded():
    assert blocked_reason("下单", "failed") == "前置用例「下单」执行失败，本用例未执行"
    assert "被阻塞" in blocked_reason("下单", "blocked")
    assert "执行超时" in blocked_reason("下单", "timed_out")
    assert len(blocked_reason("很长" * 200, "failed")) <= 255