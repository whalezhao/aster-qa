import uuid

from app.runner.persist import _version_for


def test_version_for_reads_execution_mapping():
    case_id = uuid.uuid4()
    version_id = uuid.uuid4()
    mapping = {str(case_id): {"version_id": str(version_id), "version_no": 7}}
    assert _version_for(mapping, case_id) == (version_id, 7)


def test_version_for_supports_legacy_string_mapping_and_missing_values():
    case_id = uuid.uuid4()
    version_id = uuid.uuid4()
    assert _version_for({str(case_id): str(version_id)}, case_id) == (version_id, None)
    assert _version_for({}, case_id) == (None, None)
    assert _version_for({"bad": {"version_id": "not-a-uuid"}}, case_id) == (None, None)