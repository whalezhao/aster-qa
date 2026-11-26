import yaml

from app.datasources import referenced_data_sources
from app.schemas import EnvironmentDataSourceIn
from app.yamlcheck import validate, validate_readonly_sql


def _case(step: dict) -> str:
    return yaml.safe_dump(
        {"cases": [{"name": "check amount", "steps": [step]}]},
        allow_unicode=True,
        sort_keys=False,
    )


def test_postgres_datasource_and_placeholders():
    body = EnvironmentDataSourceIn(
        name="PG_DB",
        dialect="postgres",
        host="127.0.0.1",
        port=5432,
        database="qa",
        username="qa",
        password="secret",
    )
    assert body.dialect == "postgres"
    assert validate_readonly_sql("SELECT amount FROM orders WHERE id = $1") is None


def test_readonly_sql_guard():
    assert validate_readonly_sql("SELECT amount FROM orders WHERE id = ?") is None
    assert validate_readonly_sql("WITH q AS (SELECT 1) SELECT * FROM q") is None
    assert validate_readonly_sql("SELECT 'update' AS word") is None
    assert validate_readonly_sql("SELECT 1;") is None
    assert "多条语句" in (validate_readonly_sql("SELECT 1; DROP TABLE orders") or "")
    assert "SELECT" in (validate_readonly_sql("UPDATE orders SET amount = 1") or "")
    assert "只读" in (
        validate_readonly_sql("WITH q AS (SELECT 1) DELETE FROM orders") or ""
    )
    assert "只读" in (
        validate_readonly_sql("SELECT * FROM orders INTO OUTFILE '/tmp/x'") or ""
    )
    assert "只读" in (validate_readonly_sql("SELECT * FROM orders FOR UPDATE") or "")


def test_dbassert_yaml_accepts_valid_shape():
    text = _case(
        {
            "dbAssert": {
                "datasource": "QA_DB",
                "sql": "SELECT amount FROM orders WHERE id = ?",
                "params": [1],
                "column": "amount",
                "prompt": "订单金额",
                "as": "number",
                "tolerance": 0.01,
            }
        }
    )
    errors, count = validate(text)
    assert errors == []
    assert count == 1


def test_dbassert_yaml_rejects_bad_shapes():
    base = {
        "datasource": "QA_DB",
        "sql": "SELECT amount FROM orders",
        "prompt": "订单金额",
    }
    for patch, expected in [
        ({"sql": "DELETE FROM orders"}, "SELECT"),
        ({"selector": "#amount"}, "只能指定"),
        ({"as": "date"}, "number/string/boolean"),
        ({"tolerance": -1}, "tolerance"),
        ({"row": -1}, "row"),
        ({"datasource": "1BAD"}, "datasource"),
        ({"unknown": 1}, "未知字段"),
        ({"options": {}}, "不支持 options"),
    ]:
        errors, _ = validate(_case({"dbAssert": {**base, **patch}}))
        assert errors, patch
        assert any(expected in error for error in errors), (patch, errors)


def test_capture_yaml_validation():
    good = _case(
        {"capture": {"name": "ORDER_NO", "selector": "#order-no", "as": "string"}}
    )
    errors, _ = validate(good)
    assert errors == []

    bad = _case({"capture": {"name": "1BAD", "selector": "#x"}})
    errors, _ = validate(bad)
    assert any("变量名" in error for error in errors)

    two_sources = _case(
        {"capture": {"name": "ORDER_NO", "selector": "#x", "prompt": "金额"}}
    )
    errors, _ = validate(two_sources)
    assert any("只能指定" in error for error in errors)


def test_referenced_data_sources_includes_lifecycle_steps():
    text = yaml.safe_dump(
        {
            "beforeAll": [
                {"dbAssert": {"datasource": "SETUP_DB", "sql": "SELECT 1", "prompt": "x"}}
            ],
            "cases": [
                {
                    "name": "check",
                    "steps": [
                        {
                            "dbAssert": {
                                "datasource": "QA_DB",
                                "sql": "SELECT 1",
                                "prompt": "x",
                            }
                        }
                    ],
                }
            ],
        },
        allow_unicode=True,
    )
    assert referenced_data_sources([text]) == {"SETUP_DB", "QA_DB"}