"""核心纯逻辑的回归测试。

不依赖数据库：任务状态聚合、YAML 校验、AI 摘要、登录限流、产物清理这几处一旦算错，
都是「静默给出错误结果」，比接口直接报错更难发现。
"""

import uuid

from app.ai_case import build_reply, extract_yaml, missing_cache_steps, summarize_yaml
from app.api.auth import _clear, _hit
from app.api.task_common import split_shards
from app.runner import staging
from app.taskstatus import aggregate
from app.yamlcheck import validate

CASE_YAML = """\
beforeEach:
  - gotoUrl: ${BASE_URL}
cases:
  - name: 登录
    steps:
      - aiAct:
          prompt: 打开登录页
          options:
            cacheable: true
      - aiAct:
          prompt: 输入账号密码并登录
      - aiAssert: 进入工作台
"""


def test_aggregate_task_status():
    assert aggregate([]) == "draft"
    assert aggregate(["queued"]) == "running"
    assert aggregate(["preparing", "succeeded"]) == "running"
    assert aggregate(["succeeded"]) == "completed"
    assert aggregate(["succeeded", "failed"]) == "completed"
    assert aggregate(["failed"]) == "failed"
    assert aggregate(["cancelled", "failed"]) == "failed"
    assert aggregate(["cancelled", "cancelled"]) == "cancelled"


def test_split_shards():
    ids = [uuid.uuid4() for _ in range(5)]
    assert split_shards([], 4) == []
    assert split_shards(ids, 0) == [ids]
    chunks = split_shards(ids, 2)
    assert [len(chunk) for chunk in chunks] == [2, 2, 1]
    assert [case_id for chunk in chunks for case_id in chunk] == ids


def test_yaml_validation_accepts_valid_case():
    errors, _warnings = validate(CASE_YAML)
    assert errors == []


def test_yaml_validation_rejects_two_nodes_in_one_step():
    bad = """\
cases:
  - name: a
    steps:
      - aiAct: 打开页面
        cacheable: true
"""
    errors, _warnings = validate(bad)
    assert errors


def test_extract_and_summarize_yaml():
    reply = f"说明文字\n```yaml\n{CASE_YAML}```\n"
    assert extract_yaml(reply).strip() == CASE_YAML.strip()

    summary = summarize_yaml(CASE_YAML)
    assert "**用例：登录**" in summary
    assert "打开登录页 → 输入账号密码并登录" in summary
    assert "进入工作台" in summary
    assert "1 步启用缓存" in summary

    # 模型只给 YAML 时，气泡里也必须有结构化摘要，而不是「已更新」
    final = build_reply(reply, CASE_YAML)
    assert final.startswith("**用例：登录**")
    assert "说明文字" in final


def test_missing_cache_steps_counts_only_ai_act():
    assert missing_cache_steps(CASE_YAML) == 1
    annotated = CASE_YAML.replace(
        "      - aiAct:\n          prompt: 输入账号密码并登录",
        "      - aiAct:\n          prompt: 输入账号密码并登录\n          options:\n            cacheable: false",
    )
    assert missing_cache_steps(annotated) == 0
    assert missing_cache_steps("cases:\n  - name: a\n    steps:\n      - aiAssert: 通过\n") == 0


def test_login_limiter_blocks_and_resets():
    key = f"test:{uuid.uuid4()}"
    assert [_hit(key, 3) for _ in range(3)] == [True, True, True]
    assert _hit(key, 3) is False
    _clear(key)
    assert _hit(key, 3) is True
    _clear(key)


def test_purge_run_artifacts_stays_inside_runner(tmp_path):
    runs_root = tmp_path / ".runs"
    run_dir = runs_root / str(uuid.uuid4())
    run_dir.mkdir(parents=True)
    (run_dir / "result.txt").write_text("x")
    outside = tmp_path / "outside"
    outside.mkdir()

    staging.purge_run_artifacts(
        runner_root=tmp_path,
        work_dirs=[str(run_dir), str(outside)],
        midscene_run_ids=[],
    )
    assert not run_dir.exists()
    assert outside.exists()  # 不在 runner 目录内的路径一律不碰

    report_root = tmp_path / "midscene_run" / "report"
    report_root.mkdir(parents=True)
    report = report_root / "midscene-e2e-20260101-abc.html"
    report.write_text("<html></html>")
    staging.purge_run_artifacts(
        runner_root=tmp_path, work_dirs=[], midscene_run_ids=["20260101-abc"]
    )
    assert not report.exists()

    # 路径穿越的 runId 必须被拒绝
    evil = tmp_path / "evil.html"
    evil.write_text("x")
    staging.purge_run_artifacts(runner_root=tmp_path, work_dirs=[], midscene_run_ids=["../evil"])
    assert evil.exists()
