import uuid
from types import SimpleNamespace

from app.api.task_common import task_manage_role


def test_creator_can_manage_own_task_as_member():
    me = SimpleNamespace(id=uuid.uuid4())
    task = SimpleNamespace(created_by=me.id)
    assert task_manage_role(task, me) == "member"


def test_other_member_needs_admin_to_manage_task():
    task = SimpleNamespace(created_by=uuid.uuid4())
    me = SimpleNamespace(id=uuid.uuid4())
    assert task_manage_role(task, me) == "admin"


def test_task_without_creator_needs_admin():
    task = SimpleNamespace(created_by=None)
    me = SimpleNamespace(id=uuid.uuid4())
    assert task_manage_role(task, me) == "admin"