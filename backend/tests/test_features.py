"""十项能力的纯逻辑回归测试（不依赖数据库）。"""

import json
import uuid
from datetime import UTC, datetime

import pytest

from app.case_versions import diff_text
from app.ci_tokens import generate_token, hash_token, parse_scopes
from app.coverage import compute_requirement_coverage
from app.crypto import decrypt_secret, encrypt_secret
from app.environments import validate_variable_key
from app.preflight import summarize_checks
from app.quality_gate import gate_result
from app.runner import staging
from app.scheduler import compute_next_run, validate_schedule
from app.webhook_channels import (
    provider_business_error,
    render_provider_request,
)


def test_crypto_roundtrip_and_prefix():
    token = encrypt_secret("s3cret")
    assert token.startswith("enc:v1:")
    assert decrypt_secret(token) == "s3cret"
    assert decrypt_secret("plain") == "plain"


def test_variable_key_validation():
    assert validate_variable_key("USERNAME", is_secret=False) == "USERNAME"
    assert validate_variable_key("API_TOKEN", is_secret=True) == "API_TOKEN"
    with pytest.raises(ValueError):
        validate_variable_key("BASE_URL", is_secret=False)
    with pytest.raises(ValueError):
        validate_variable_key("bad-key", is_secret=False)
    with pytest.raises(ValueError):
        validate_variable_key("NODE_OPTIONS", is_secret=True)
    with pytest.raises(ValueError):
        validate_variable_key("MIDSCENE_MODEL_API_KEY", is_secret=True)


def test_schedule_next_run_and_validation():
    base = datetime(2026, 1, 1, tzinfo=UTC)
    nxt = compute_next_run("0 2 * * *", "Asia/Shanghai", base=base)
    # 2026-01-01 00:00 UTC = 08:00 CST，下一次 02:00 CST 是 UTC 前一天 18:00
    assert nxt == datetime(2026, 1, 1, 18, 0, tzinfo=UTC)
    assert validate_schedule("*/5 * * * *", "UTC") == ("*/5 * * * *", "UTC")
    with pytest.raises(ValueError):
        validate_schedule("bad", "UTC")
    with pytest.raises(ValueError):
        validate_schedule("0 2 * * *", "Mars/Olympus")


def test_quality_gate():
    run = {"status": "succeeded", "failure_kind": None, "total": 10, "passed": 9,
           "failed": 1, "not_run": 0}
    ok = gate_result(
        enabled=True, min_pass_rate=0.8, fail_on_p0=False,
        batch_active=False, runs=[run], failed_p0=0,
    )
    assert ok["status"] == "passed" and ok["passed"] is True
    assert ok["pass_rate"] == 0.9

    low = gate_result(
        enabled=True, min_pass_rate=0.95, fail_on_p0=False,
        batch_active=False, runs=[run], failed_p0=0,
    )
    assert low["status"] == "failed"

    p0 = gate_result(
        enabled=True, min_pass_rate=None, fail_on_p0=True,
        batch_active=False, runs=[run], failed_p0=2,
    )
    assert p0["status"] == "failed" and p0["failed_p0"] == 2

    infra = dict(run, failure_kind="ai_quota")
    excluded = gate_result(
        enabled=True, min_pass_rate=None, fail_on_p0=False,
        batch_active=False, runs=[infra], failed_p0=0,
    )
    assert excluded["status"] == "no_data"
    assert excluded["excluded_runs"] == 1

    pending = gate_result(
        enabled=True, min_pass_rate=None, fail_on_p0=False,
        batch_active=True, runs=[run], failed_p0=0,
    )
    assert pending["status"] == "pending"

    disabled = gate_result(
        enabled=False, min_pass_rate=None, fail_on_p0=False,
        batch_active=False, runs=[], failed_p0=0,
    )
    assert disabled["status"] == "disabled" and disabled["passed"] is True


def test_requirement_coverage_statuses():
    rows = [
        {"requirement_id": "REQ-1", "feature_id": uuid.uuid4(), "feature_name": "登录",
         "project_name": "A", "case_id": uuid.uuid4(), "status": "success",
         "failure_kind": None, "last_run_at": None},
        {"requirement_id": "REQ-1", "feature_id": uuid.uuid4(), "feature_name": "登录",
         "project_name": "A", "case_id": uuid.uuid4(), "status": None,
         "failure_kind": None, "last_run_at": None},
        {"requirement_id": "REQ-2", "feature_id": uuid.uuid4(), "feature_name": "支付",
         "project_name": "A", "case_id": uuid.uuid4(), "status": "failed",
         "failure_kind": None, "last_run_at": None},
        {"requirement_id": "REQ-3", "feature_id": uuid.uuid4(), "feature_name": "退款",
         "project_name": "A", "case_id": uuid.uuid4(), "status": "failed",
         "failure_kind": "ai_service", "last_run_at": None},
    ]
    data = compute_requirement_coverage(rows)
    by_id = {item["requirement_id"]: item for item in data["requirements"]}
    assert by_id["REQ-1"]["status"] == "partial"
    assert by_id["REQ-2"]["status"] == "failed"
    assert by_id["REQ-3"]["status"] == "infra"
    assert data["summary"]["total"] == 3


def test_diff_marks_changes():
    diff = diff_text("a\nb\n", "a\nc\n", "old", "new")
    assert "-b" in diff and "+c" in diff
    assert diff_text("a", "a", "old", "new") == ""


def test_ci_token_hash_and_scopes():
    plaintext, digest, prefix = generate_token()
    assert plaintext.startswith("aqt_")
    assert len(digest) == 64
    assert hash_token(plaintext) == digest
    assert prefix == plaintext[:12]
    assert parse_scopes("run,read") == {"run", "read"}
    assert parse_scopes(None) == {"run", "read"}
    with pytest.raises(ValueError):
        parse_scopes("admin")


def test_webhook_channel_payloads():
    payload = {
        "event": "batch.completed",
        "data": {
            "batch": {"name": "夜间回归", "trigger": "schedule"},
            "runs": [{"total": 4, "passed": 3, "failed": 1}],
        },
    }
    rendered = render_provider_request(
        "wecom", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x", None,
        "batch.completed", payload,
    )
    assert rendered is not None
    _url, body, _headers = rendered
    doc = json.loads(body)
    assert doc["msgtype"] == "markdown"
    assert "夜间回归" in doc["markdown"]["content"]

    ding = render_provider_request(
        "dingtalk", "https://oapi.dingtalk.com/robot/send?access_token=x", "secret",
        "batch.completed", payload,
    )
    assert ding is not None
    signed_url = ding[0]
    assert "timestamp=" in signed_url and "sign=" in signed_url

    assert provider_business_error("wecom", 200, '{"errcode":93000,"errmsg":"invalid"}')
    assert provider_business_error("wecom", 200, '{"errcode":0}') is None
    assert provider_business_error("slack", 200, '{"ok":false,"error":"channel_not_found"}')
    assert provider_business_error("generic", 200, '{"errcode":1}') is None


def test_preflight_summary():
    checks = [
        {"ok": False, "severity": "warning", "overridable": False},
        {"ok": True, "severity": "ok", "overridable": False},
    ]
    assert summarize_checks(checks) is True
    checks.append({"ok": False, "severity": "error", "overridable": False})
    assert summarize_checks(checks) is False
    checks[-1]["overridable"] = True
    assert summarize_checks(checks) is True


def test_staging_writes_project_variables():
    config = staging.render_config(
        run_id=uuid.uuid4(),
        include_glob=".runs/x/cases/*.yaml",
        retry=1,
        tag_include=[],
        tag_exclude=[],
        base_url="https://example.test",
        timeout_ms=1000,
        variables={"USERNAME": "qa"},
    )
    assert '"USERNAME": "qa"' in config
    assert '"BASE_URL": "https://example.test"' in config
