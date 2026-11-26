import json
import uuid

from app.runner import session


def test_session_storage_validation_and_paths(tmp_path):
    pid, eid = uuid.uuid4(), uuid.uuid4()
    path = session.storage_state_path(tmp_path, pid, eid)
    assert path == (
        tmp_path
        / "midscene_run"
        / "sessions"
        / str(pid)
        / str(eid)
        / "storage.json"
    )
    path.parent.mkdir(parents=True)
    assert not session.is_readable_storage_state(path)

    path.write_text(json.dumps({"cookies": [], "origins": []}), encoding="utf-8")
    assert session.is_readable_storage_state(path)
    path.write_text("not-json", encoding="utf-8")
    assert not session.is_readable_storage_state(path)


def test_session_install_is_atomic_and_removal_is_scoped(tmp_path):
    pid, eid = uuid.uuid4(), uuid.uuid4()
    target = session.storage_state_path(tmp_path, pid, eid)
    temp = target.with_name("temp.json")
    temp.parent.mkdir(parents=True)
    temp.write_text(json.dumps({"cookies": [], "origins": []}), encoding="utf-8")
    session.install_storage_state(temp, target)
    assert target.is_file()
    assert not temp.exists()

    session.remove_session(tmp_path, pid, eid)
    assert not session.session_dir(tmp_path, pid, eid).exists()
    # 不能误删 sessions 根目录
    assert session.session_root(tmp_path).exists()


def test_partial_login_state_needs_permission_and_a_readable_file():
    assert session.keep_partial_login_state(allow_partial=True, state_readable=True)
    assert not session.keep_partial_login_state(
        allow_partial=False, state_readable=True
    )
    assert not session.keep_partial_login_state(
        allow_partial=True, state_readable=False
    )


def test_base_url_hash_is_stable_and_distinguishes_urls():
    assert session.base_url_hash("https://a.test") == session.base_url_hash(
        "https://a.test"
    )
    assert session.base_url_hash("https://a.test") != session.base_url_hash(
        "https://b.test"
    )