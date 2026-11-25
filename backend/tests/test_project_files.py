"""项目测试文件与 upload/download 节点的纯逻辑测试。"""

import uuid
from pathlib import Path

import pytest
import yaml

from app import ai_case
from app.project_files import (
    referenced_file_keys,
    resolve_storage_path,
    sanitize_filename,
    validate_file_key,
)
from app.runner import staging
from app.yamlcheck import validate as validate_yaml


def test_file_key_validation():
    assert validate_file_key("INVOICE_PDF") == "INVOICE_PDF"
    with pytest.raises(ValueError):
        validate_file_key("../x")
    with pytest.raises(ValueError):
        validate_file_key("1ABC")


def test_filename_is_reduced_to_basename():
    assert sanitize_filename("../../发票.pdf") == "发票.pdf"
    assert sanitize_filename("a/b/c.pdf") == "c.pdf"
    assert sanitize_filename("a:b?.pdf") == "a_b_.pdf"
    assert sanitize_filename("") == "file"


def test_storage_path_cannot_escape_assets_root(tmp_path):
    root = tmp_path / "assets"
    with pytest.raises(ValueError):
        resolve_storage_path(root, "../secret.txt")


def test_referenced_file_keys_walks_lifecycle_and_cases():
    text = """
beforeEach:
  - upload: { prompt: 上传前置文件, file: SETUP }
cases:
  - name: A
    steps:
      - upload:
          prompt: 上传发票
          file: INVOICE
      - upload:
          prompt: 上传图片
          files: [IMAGE_1, IMAGE_2]
      - aiAct: 其他步骤
"""
    assert referenced_file_keys(text) == {"SETUP", "INVOICE", "IMAGE_1", "IMAGE_2"}


def test_yamlcheck_accepts_upload_download_and_rejects_bad_shapes():
    good = """
cases:
  - name: A
    steps:
      - upload: { prompt: 点击上传, file: INVOICE }
      - download: { trigger: 点击下载, filename: 回执.pdf }
"""
    errors, _ = validate_yaml(good)
    assert errors == []

    bad = """
cases:
  - name: A
    steps:
      - upload: { prompt: 点击上传 }
      - download: { filename: 回执.pdf }
      - upload:
          prompt: 上传
          file: INVOICE
          options: { cacheable: false }
"""
    errors, _ = validate_yaml(bad)
    assert any("file 或 files" in item for item in errors)
    assert any("trigger" in item for item in errors)
    assert any("不支持 options" in item for item in errors)


def test_build_messages_injects_project_files():
    messages = ai_case.build_messages(
        [],
        current_yaml=None,
        feature_name="发票",
        files=[{"key": "INVOICE", "name": "发票.pdf"}],
    )
    system = messages[0]["content"]
    assert "当前可用的测试文件" in system
    assert "`INVOICE`（发票.pdf）" in system

    empty = ai_case.build_messages(
        [], current_yaml=None, feature_name="发票", files=[]
    )
    assert "还没有测试文件" in empty[0]["content"]


def test_delivery_rows_include_upload_and_download():
    text = """
cases:
  - name: A
    steps:
      - upload: { prompt: 点击上传发票, file: INVOICE }
      - download: { trigger: 点击下载回执, filename: 回执.pdf }
"""
    rows = ai_case.test_cases_of(text)[0]["rows"]
    assert rows[0]["action"] == "点击上传发票"
    assert rows[0]["expected"] == "上传文件：INVOICE"
    assert rows[1]["action"] == "下载：点击下载回执"
    assert rows[1]["expected"] == "下载文件：回执.pdf"


def test_generated_config_registers_file_nodes():
    config = staging.render_config(
        run_id=uuid.uuid4(),
        include_glob="cases/*.yaml",
        retry=0,
        tag_include=[],
        tag_exclude=[],
        base_url=None,
        timeout_ms=1000,
    )
    assert "createFileNodes" in config
    assert "getAgentFromContext" in config


def test_steps_of_exposes_upload_download_fields():
    text = """
cases:
  - name: A
    steps:
      - upload:
          prompt: 上传
          file: INVOICE
      - download:
          trigger: 下载
          filename: 回执.pdf
          minBytes: 1
"""
    steps = ai_case.steps_of(text)
    assert steps[0]["file"] == "INVOICE"
    assert steps[1]["trigger"] == "下载"
    assert steps[1]["filename"] == "回执.pdf"
    assert steps[1]["minBytes"] == 1


def test_steps_of_exposes_existing_ai_options():
    text = """
cases:
  - name: A
    steps:
      - aiAct:
          prompt: 操作
          options:
            cacheable: true
            deepLocate: true
            effort: fast
            context: 页面刚加载
      - aiWaitFor:
          prompt: 等待
          options:
            timeoutMs: 30000
      - aiAssert:
          prompt: 断言
          message: 失败文案
"""
    steps = ai_case.steps_of(text)
    assert steps[0]["cacheable"] is True
    assert steps[0]["deepLocate"] is True
    assert steps[0]["effort"] == "fast"
    assert steps[0]["context"] == "页面刚加载"
    assert steps[1]["timeoutMs"] == 30000
    assert steps[2]["message"] == "失败文案"


def test_apply_step_options_updates_upload_and_download_fields():
    text = """
cases:
  - name: A
    steps:
      - upload:
          prompt: 上传
          file: OLD
      - download:
          trigger: 下载
          filename: old.txt
          minBytes: 1
"""
    out = ai_case.apply_step_options(
        text,
        [
            {
                "case_index": 0,
                "step": 0,
                "prompt": "点击上传入口",
                "files": ["A", "B"],
            },
            {
                "case_index": 0,
                "step": 1,
                "trigger": "点击导出",
                "filename": "new.txt",
                "min_bytes": 10,
                "timeout_ms": 30000,
                "save_as": "result.txt",
            },
        ],
    )
    steps = yaml.safe_load(out)["cases"][0]["steps"]
    assert steps[0]["upload"] == {"prompt": "点击上传入口", "files": ["A", "B"]}
    assert steps[1]["download"] == {
        "trigger": "点击导出",
        "filename": "new.txt",
        "minBytes": 10,
        "timeoutMs": 30000,
        "saveAs": "result.txt",
    }


def test_stage_copies_referenced_file(tmp_path):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"pdf")
    staged = staging.stage(
        runner_root=tmp_path / "runner",
        run_id=uuid.uuid4(),
        cases=[(uuid.uuid4(), "cases:\n  - name: A\n    steps:\n      - aiAssert: ok\n")],
        base_url=None,
        retry=0,
        timeout_ms=1000,
        files=[("INVOICE", source, "发票.pdf")],
    )
    assert staged.files == {"INVOICE": str(staged.files_dir / "INVOICE" / "发票.pdf")}
    assert Path(staged.files["INVOICE"]).read_bytes() == b"pdf"
    assert staged.downloads_dir.is_dir()