"""登录会话缓存的路径、原子写入和跨进程锁。"""

import fcntl
import hashlib
import json
import os
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path


def session_root(runner_root: Path) -> Path:
    return runner_root / "midscene_run" / "sessions"


def session_dir(runner_root: Path, project_id: uuid.UUID, environment_id: uuid.UUID) -> Path:
    return session_root(runner_root) / str(project_id) / str(environment_id)


def storage_relative_path(project_id: uuid.UUID, environment_id: uuid.UUID) -> str:
    return f"{project_id}/{environment_id}/storage.json"


def storage_state_path(
    runner_root: Path, project_id: uuid.UUID, environment_id: uuid.UUID
) -> Path:
    return session_dir(runner_root, project_id, environment_id) / "storage.json"


def base_url_hash(base_url: str | None) -> str:
    return hashlib.sha256((base_url or "").encode("utf-8")).hexdigest()[:32]


def is_readable_storage_state(path: Path) -> bool:
    """storageState 至少要是一个 JSON 对象；损坏缓存按未命中处理。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return isinstance(data, dict) and (
        isinstance(data.get("cookies"), list) or isinstance(data.get("origins"), list)
    )


def keep_partial_login_state(*, allow_partial: bool, state_readable: bool) -> bool:
    """登录用例未通过时，若这次执行仍生成了 storageState，交给检查用例裁决。"""
    return allow_partial and state_readable


def install_storage_state(temp: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temp, target)
    try:
        target.chmod(0o600)
    except OSError:
        pass


def remove_session(
    runner_root: Path, project_id: uuid.UUID, environment_id: uuid.UUID
) -> None:
    target = session_dir(runner_root, project_id, environment_id).resolve()
    root = session_root(runner_root).resolve()
    if target.is_relative_to(root) and target != root and target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def remove_project_sessions(runner_root: Path, project_id: uuid.UUID) -> None:
    target = (session_root(runner_root) / str(project_id)).resolve()
    root = session_root(runner_root).resolve()
    if target.is_relative_to(root) and target != root and target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


@contextmanager
def session_lock(
    runner_root: Path, project_id: uuid.UUID, environment_id: uuid.UUID
):
    """同一项目/环境只允许一个 worker 刷新会话。"""
    directory = session_dir(runner_root, project_id, environment_id)
    directory.mkdir(parents=True, exist_ok=True)
    lock_path = directory / ".lock"
    with lock_path.open("w") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)