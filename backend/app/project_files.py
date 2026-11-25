"""项目测试文件的路径、命名与 YAML 引用解析。

文件内容不在数据库里：数据库只存元数据，内容放在 API 和 worker 共享的
`assets_dir` 下。这里集中处理所有与路径/文件名有关的规则，避免上传接口和
执行器各自实现一套。
"""

import re
import shutil
import uuid
from pathlib import Path

import yaml

FILE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")

# 这些类型会在浏览器里直接执行脚本；测试文件用不到，默认拒绝，降低下载后被误打开的风险。
_BLOCKED_SUFFIXES = {
    ".html",
    ".htm",
    ".xhtml",
    ".svg",
    ".js",
    ".mjs",
    ".cjs",
    ".exe",
    ".sh",
    ".bat",
    ".cmd",
    ".ps1",
}

_UNSAFE_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def validate_file_key(key: str) -> str:
    key = (key or "").strip()
    if not FILE_KEY_RE.match(key):
        raise ValueError("文件 key 只能包含字母、数字、下划线，且不能以数字开头")
    return key


def sanitize_filename(name: str, *, fallback: str = "file") -> str:
    """只保留文件名本身，绝不接受客户端传来的路径。"""
    clean = Path(name or "").name
    clean = _UNSAFE_NAME_CHARS.sub("_", clean).strip().strip(".")
    return (clean or fallback)[:255]


def ensure_allowed_suffix(name: str) -> None:
    suffix = Path(name).suffix.lower()
    if suffix in _BLOCKED_SUFFIXES:
        raise ValueError(f"不支持上传 {suffix} 文件")


def project_assets_dir(assets_root: Path, team_id: uuid.UUID, project_id: uuid.UUID) -> Path:
    return assets_root / str(team_id) / str(project_id)


def storage_relative_path(
    team_id: uuid.UUID,
    project_id: uuid.UUID,
    file_id: uuid.UUID,
    original_name: str,
) -> str:
    # file_id 目录隔离同名文件；原始文件名只用于让被测页面看到真实名字
    return "/".join(
        (str(team_id), str(project_id), str(file_id), sanitize_filename(original_name))
    )


def resolve_storage_path(assets_root: Path, storage_path: str) -> Path:
    """把库里的相对路径落到磁盘，并确认没有越出 assets 根目录。"""
    root = assets_root.resolve()
    target = (root / storage_path).resolve()
    if not target.is_relative_to(root):
        raise ValueError("测试文件路径非法")
    return target


def referenced_file_keys(yaml_text: str) -> set[str]:
    """收集用例里 upload 节点引用的文件 key。

    只认平台节点；不解析 `${FILE_*}` 这类变量，避免和普通环境变量混在一起。
    """
    try:
        doc = yaml.safe_load(yaml_text)
    except yaml.YAMLError:
        return set()
    if not isinstance(doc, dict):
        return set()

    keys: set[str] = set()

    def visit(steps: object) -> None:
        if not isinstance(steps, list):
            return
        for step in steps:
            if not isinstance(step, dict) or len(step) != 1:
                continue
            node, value = next(iter(step.items()))
            if node != "upload" or not isinstance(value, dict):
                continue
            file_key = value.get("file")
            if isinstance(file_key, str) and file_key.strip():
                keys.add(file_key.strip())
            file_keys = value.get("files")
            if isinstance(file_keys, list):
                keys.update(
                    item.strip()
                    for item in file_keys
                    if isinstance(item, str) and item.strip()
                )

    for phase in ("beforeAll", "beforeEach", "afterEach", "afterAll"):
        visit(doc.get(phase))
    for case in doc.get("cases") or []:
        if isinstance(case, dict):
            visit(case.get("steps"))
    return keys


def remove_project_assets(assets_root: Path, team_id: uuid.UUID, project_id: uuid.UUID) -> None:
    """删除系统文件库目录。路径由 UUID 拼成，不来自用户输入。"""
    target = project_assets_dir(assets_root, team_id, project_id).resolve()
    root = assets_root.resolve()
    if target.is_relative_to(root) and target != root and target.is_dir():
        shutil.rmtree(target, ignore_errors=True)