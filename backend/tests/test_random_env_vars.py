"""随机环境变量的纯逻辑测试。"""

import string

import pytest
from pydantic import ValidationError

from app.environments import (
    RANDOM_NUMBER_CHARS,
    RANDOM_STRING_CHARS,
    generate_random_value,
)
from app.schemas import EnvironmentVariableIn


def test_random_string_length_and_charset() -> None:
    seen: list[str] = []
    value = generate_random_value(
        "random_string",
        3,
        choice=lambda alphabet: (seen.append(alphabet), "aZ9"[len(seen) - 1])[1],
    )
    assert value == "aZ9"
    assert set(seen[0]) == set(string.ascii_letters + string.digits)

    value = generate_random_value("random_string", 128)
    assert len(value) == 128
    assert set(value) <= set(RANDOM_STRING_CHARS)


def test_random_number_allows_leading_zero() -> None:
    assert generate_random_value("random_number", 4, choice=lambda _: "0") == "0000"

    value = generate_random_value("random_number", 6)
    assert len(value) == 6
    assert value.isdigit()
    assert set(value) <= set(RANDOM_NUMBER_CHARS)


def test_random_value_rejects_bad_config() -> None:
    with pytest.raises(ValueError):
        generate_random_value("fixed", 8)
    with pytest.raises(ValueError):
        generate_random_value("random_number", 0)
    with pytest.raises(ValueError):
        generate_random_value("random_number", 129)


def test_environment_variable_schema_requires_random_length() -> None:
    assert EnvironmentVariableIn(key="NAME").value_mode is None
    assert (
        EnvironmentVariableIn(
            key="NAME", value_mode="random_number", random_length=6
        ).random_length
        == 6
    )
    with pytest.raises(ValidationError):
        EnvironmentVariableIn(key="NAME", value_mode="random_string")
    with pytest.raises(ValidationError):
        EnvironmentVariableIn(
            key="NAME", value_mode="random_string", random_length=0
        )
    with pytest.raises(ValidationError):
        EnvironmentVariableIn(
            key="NAME", value_mode="random_string", random_length=129
        )