"""AI 用例面板的纯逻辑测试（不连数据库）。"""

import json

import yaml

from app import ai_case
from app.runner import parsers


def test_extract_yaml_prefers_last_fence_and_handles_empty():
    two = (
        "旧版：\n```yaml\ncases:\n  - name: old\n```\n"
        "新版：\n```yaml\ncases:\n  - name: new\n```\n"
    )
    assert "new" in (ai_case.extract_yaml(two) or "")
    assert ai_case.extract_yaml("已清空。\n```yaml\n```\n") == ""
    assert ai_case.extract_yaml("请补充一下测试数据。") is None


def test_extract_yaml_from_middle_of_prose():
    reply = (
        "这里说明一下：\n"
        "beforeEach:\n  - gotoUrl: ${BASE_URL}\n"
        "cases:\n  - name: 登录\n    steps:\n      - aiAct: 打开登录页\n"
        "以上，请确认。\n"
    )
    text = ai_case.extract_yaml(reply)
    assert text is not None
    doc = yaml.safe_load(text)
    assert doc["cases"][0]["name"] == "登录"


def test_steps_of_groups_by_case():
    text = (
        "cases:\n"
        "  - name: A\n    steps:\n      - aiAct: 打开\n      - aiAssert: 成功\n"
        "  - name: B\n    steps:\n      - aiWaitFor: 列表出现\n"
    )
    steps = ai_case.steps_of(text)
    assert [(s["case"], s["case_index"], s["index"], s["kind"]) for s in steps] == [
        ("A", 0, 0, "aiAct"),
        ("A", 0, 1, "aiAssert"),
        ("B", 1, 0, "aiWaitFor"),
    ]


def test_apply_step_options_only_on_whitelisted_nodes():
    text = (
        "cases:\n"
        "  - name: A\n    steps:\n"
        "      - aiAct: 打开页面\n"
        "      - aiWaitFor:\n          prompt: 等待列表\n"
        "      - aiAssert: 列表出现\n"
        "      - aiTap: 按钮\n"
    )
    out = ai_case.apply_step_options(
        text,
        [
            {
                "case_index": 0,
                "step": 0,
                "cache": True,
                "deep_locate": True,
                "effort": "deepThink",
                "context": "页面刚加载",
            },
            {"case_index": 0, "step": 1, "timeout_ms": 5000, "context": "最多等 5 秒"},
            {"case_index": 0, "step": 2, "message": "列表没出现", "context": "断言上下文"},
            {"case_index": 0, "step": 3, "cache": True},
        ],
    )
    steps = yaml.safe_load(out)["cases"][0]["steps"]
    act = steps[0]["aiAct"]
    assert act["options"] == {
        "cacheable": True,
        "deepLocate": True,
        "effort": "deepThink",
        "context": "页面刚加载",
    }
    wait = steps[1]["aiWaitFor"]
    assert wait["options"] == {"timeoutMs": 5000, "context": "最多等 5 秒"}
    assertion = steps[2]["aiAssert"]
    assert assertion["message"] == "列表没出现"
    assert assertion["options"] == {"context": "断言上下文"}
    # aiTap 不在白名单里，塞 options 会被执行器判输入不合法
    assert steps[3]["aiTap"] == "按钮"


def test_apply_step_options_removes_keys_and_empty_options():
    text = (
        "cases:\n"
        "  - name: A\n    steps:\n"
        "      - aiAct:\n          prompt: 打开\n          options:\n"
        "            cacheable: true\n            deepLocate: true\n            effort: fast\n"
        "      - aiAssert:\n          message: 旧文案\n"
    )
    out = ai_case.apply_step_options(
        text,
        [
            {"case_index": 0, "step": 0, "cache": False, "deep_locate": False, "effort": "balance"},
            {"case_index": 0, "step": 1, "message": ""},
        ],
    )
    steps = yaml.safe_load(out)["cases"][0]["steps"]
    assert "options" not in steps[0]["aiAct"]
    assert "message" not in steps[1]["aiAssert"]


def test_truncate_steps_is_case_aware():
    text = (
        "cases:\n"
        "  - name: A\n    steps:\n      - aiAct: a1\n      - aiAct: a2\n      - aiAct: a3\n"
        "  - name: B\n    steps:\n      - aiAct: b1\n      - aiAct: b2\n"
    )
    doc = yaml.safe_load(ai_case.truncate_steps(text, 2, 0))
    assert [case["name"] for case in doc["cases"]] == ["A"]
    assert len(doc["cases"][0]["steps"]) == 2

    doc = yaml.safe_load(ai_case.truncate_steps(text, 1, 1))
    assert [case["name"] for case in doc["cases"]] == ["A", "B"]
    assert len(doc["cases"][0]["steps"]) == 3
    assert len(doc["cases"][1]["steps"]) == 1

    doc = yaml.safe_load(ai_case.truncate_steps(text, 1))
    assert [len(case["steps"]) for case in doc["cases"]] == [1, 1]


def test_verify_prefix_and_finalize_lock():
    old = "cases:\n  - name: A\n    steps:\n      - aiAct: a1\n      - aiAct: a2\n"
    extended = old + "      - aiAct: a3\n"
    changed = "cases:\n  - name: A\n    steps:\n      - aiAct: 改过的 a1\n      - aiAct: a2\n"

    assert ai_case.verify_prefix(old, extended) is True
    assert ai_case.verify_prefix(old, changed) is False

    reply, text, locked, diff, steps = ai_case._finalize(
        "继续", changed, old, "append"
    )
    assert locked is True
    assert text is None
    assert "改动了已经验证过的步骤" in reply
    assert diff is None
    assert steps == []

    _, text, locked, _, _ = ai_case._finalize("继续", extended, old, "append")
    assert locked is False
    assert text is not None


def test_test_cases_of_expands_before_each_and_assertions():
    text = (
        "beforeEach:\n  - gotoUrl: ${BASE_URL}\n"
        "cases:\n"
        "  - name: A\n    steps:\n"
        "      - aiAct: 输入用户名\n"
        "      - aiWaitFor: 页面加载\n"
        "      - aiAssert: 出现工作台\n"
        "  - name: B\n    steps:\n"
        "      - aiTap: 登录\n"
    )
    cases = ai_case.test_cases_of(text)
    assert [case["name"] for case in cases] == ["A", "B"]

    rows = cases[0]["rows"]
    assert rows[0] == {
        "kind": "gotoUrl",
        "phase": "precondition",
        "action": "打开页面 ${BASE_URL}",
        "expected": "页面加载完成",
        "note": None,
    }
    assert rows[1]["phase"] == "action"
    assert rows[1]["action"] == "输入用户名"
    assert rows[2]["phase"] == "wait"
    assert rows[2]["expected"] == "页面加载"
    assert rows[3]["phase"] == "assert"
    assert rows[3]["action"] == "校验当前页面"
    assert rows[3]["expected"] == "出现工作台"


def test_build_test_case_workbook_has_rows():
    from io import BytesIO

    from openpyxl import load_workbook

    from app.testcase_export import build_test_case_workbook, rows_from_yaml

    rows = rows_from_yaml(
        "cases:\n  - name: A\n    steps:\n      - aiAssert: ok\n",
        system="S",
        feature="F",
        case_set="Set",
    )
    data = build_test_case_workbook(rows)
    sheet = load_workbook(BytesIO(data)).active
    assert sheet is not None
    assert sheet["A1"].value == "系统"
    assert sheet["D2"].value == "A"
    assert sheet["F2"].value == "断言"
    assert sheet["G2"].value == "校验当前页面"
    assert sheet["H2"].value == "ok"


def test_describe_yaml_summarizes_cases():
    single = (
        "cases:\n  - name: 登录\n    steps:\n"
        "      - aiAct: 打开登录页\n"
        "      - aiAssert: 出现用户名输入框\n"
    )
    text = ai_case.describe_yaml(single)
    assert "用例「登录」" in text
    assert "共 2 步" in text
    assert "1 个操作" in text
    assert "1 条断言" in text

    multi = (
        "cases:\n"
        "  - name: A\n    steps:\n      - aiAct: a1\n      - aiAssert: ok\n"
        "  - name: B\n    steps:\n      - aiAct: b1\n"
    )
    text = ai_case.describe_yaml(multi)
    assert "包含 2 条用例" in text
    assert "1. A（2 步，1 条断言）" in text
    assert "2. B（1 步，0 条断言）" in text


def test_read_run_error_reads_before_each_failure(tmp_path):
    result_dir = tmp_path / "result"
    run_dir = result_dir / "run-1"
    run_dir.mkdir(parents=True)
    (run_dir / "summary.json").write_text(
        json.dumps(
            {
                "projects": [
                    {
                        "cases": [
                            {
                                "caseIndex": 0,
                                "status": "failed",
                                "attempts": [{"resultFile": "case-0.json"}],
                            }
                        ]
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "case-0.json").write_text(
        json.dumps(
            {
                "caseIndex": 0,
                "beforeEach": [
                    {
                        "status": "failed",
                        "error": {
                            "message": "page.goto: net::ERR_CONNECTION_REFUSED "
                            "at http://localhost:8081/"
                        },
                    }
                ],
                "steps": [],
            }
        ),
        encoding="utf-8",
    )

    assert (
        parsers.read_run_error(result_dir)
        == "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8081/"
    )


def test_read_step_results_includes_passed_steps(tmp_path):
    result_dir = tmp_path / "result"
    run_dir = result_dir / "run-1"
    run_dir.mkdir(parents=True)
    (run_dir / "summary.json").write_text(
        json.dumps(
            {
                "projects": [
                    {
                        "cases": [
                            {
                                "caseIndex": 0,
                                "attempts": [{"resultFile": "case-0.json"}],
                            }
                        ]
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "case-0.json").write_text(
        json.dumps(
            {
                "caseIndex": 0,
                "steps": [
                    {"status": "success"},
                    {"status": "failed", "error": {"message": "找不到按钮"}},
                ],
            }
        ),
        encoding="utf-8",
    )

    assert parsers.read_step_results(result_dir) == [
        {"case_index": 0, "step": 0, "status": "success"},
        {
            "case_index": 0,
            "step": 1,
            "status": "failed",
            "reason": "找不到按钮",
        },
    ]