"""项目环境与变量解析。

约定：
- 任务只存环境名；执行时在每个项目下找同名环境。
- 非密钥变量进 midscene config.variables，YAML 用 `${KEY}`。
- 密钥进子进程环境，YAML 用 `${{KEY}}`；绝不写进磁盘配置。
"""

import re
import secrets
import string
import uuid
from collections.abc import Callable

import yaml
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .crypto import decrypt_secret
from .models import Project, ProjectEnvironment, ProjectEnvironmentVariable, TestTask

DEFAULT_ENVIRONMENT = "默认"
_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
RESERVED_KEYS = {"BASE_URL"}
# 这些 key 一旦进子进程环境，等于把代码执行/加载路径交给配置者
FORBIDDEN_SECRET_KEYS = {
    "PATH",
    "HOME",
    "SHELL",
    "USER",
    "LOGNAME",
    "PWD",
    "TMPDIR",
    "NODE_OPTIONS",
    "NODE_PATH",
    "BASH_ENV",
    "ENV",
    "PYTHONPATH",
    "PYTHONHOME",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "MIDSCENE_RUN_DIR",
    "SECRET_KEY",
    "DATABASE_URL",
    "POSTGRES_PASSWORD",
}
FORBIDDEN_SECRET_PREFIXES = ("MIDSCENE_", "OPENAI_", "LD_", "DYLD_", "PYTHON", "npm_", "NODE_")


class EnvironmentResolutionError(ValueError):
    """任务环境在部分系统下不存在。消息直接给用户看。"""


def validate_variable_key(key: str, *, is_secret: bool) -> str:
    key = (key or "").strip()
    if not _KEY_RE.match(key) or len(key) > 64:
        raise ValueError("变量名只能包含字母、数字、下划线，且不能以数字开头")
    if key in RESERVED_KEYS:
        raise ValueError(f"{key} 由平台注入，不能再配置")
    if is_secret and (
        key in FORBIDDEN_SECRET_KEYS or key.startswith(FORBIDDEN_SECRET_PREFIXES)
    ):
        raise ValueError(f"{key} 是执行器保留变量，不能作为密钥注入")
    return key


async def ensure_default_environment(
    db: AsyncSession, project_id: uuid.UUID, *, created_by: uuid.UUID | None = None
) -> ProjectEnvironment:
    row = (
        await db.execute(
            select(ProjectEnvironment).where(
                ProjectEnvironment.project_id == project_id,
                ProjectEnvironment.is_default.is_(True),
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    project = await db.get(Project, project_id)
    if project is None:
        raise ValueError("系统不存在")
    row = ProjectEnvironment(
        project_id=project_id,
        name=DEFAULT_ENVIRONMENT,
        base_url=project.base_url,
        is_default=True,
        created_by=created_by,
    )
    db.add(row)
    try:
        async with db.begin_nested():
            await db.flush()
    except IntegrityError:
        # 并发创建：另一个请求已经建好了，回滚这个 savepoint 后重查
        row = (
            await db.execute(
                select(ProjectEnvironment).where(
                    ProjectEnvironment.project_id == project_id,
                    ProjectEnvironment.is_default.is_(True),
                )
            )
        ).scalar_one()
    return row


async def sync_default_environment(db: AsyncSession, project: Project) -> None:
    row = (
        await db.execute(
            select(ProjectEnvironment).where(
                ProjectEnvironment.project_id == project.id,
                ProjectEnvironment.is_default.is_(True),
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        row.base_url = project.base_url


async def resolve_run_environments(
    db: AsyncSession,
    task: TestTask,
    project_ids: set[uuid.UUID],
    *,
    environment_name: str | None = None,
) -> dict[uuid.UUID, ProjectEnvironment]:
    """按任务的环境名解析每个系统的环境；缺一个就整体拒绝。"""
    if not project_ids:
        return {}
    env_name = (environment_name or task.environment_name or "").strip() or DEFAULT_ENVIRONMENT
    rows = list(
        (
            await db.execute(
                select(ProjectEnvironment).where(
                    ProjectEnvironment.project_id.in_(project_ids),
                    ProjectEnvironment.name == env_name,
                )
            )
        ).scalars()
    )
    found = {row.project_id: row for row in rows}

    if env_name == DEFAULT_ENVIRONMENT:
        for project_id in project_ids - set(found):
            found[project_id] = await ensure_default_environment(db, project_id)

    missing = sorted(project_ids - set(found), key=str)
    if missing:
        names = list(
            (
                await db.execute(select(Project.name).where(Project.id.in_(missing)))
            ).scalars()
        )
        raise EnvironmentResolutionError(
            f"环境「{env_name}」在以下系统下不存在：{'、'.join(names) or '未知系统'}"
        )
    return found


_VAR_REF = re.compile(r"\$\{\{(\w+)\}\}|\$\{(\w+)\}")


def referenced_variables(text: str) -> set[str]:
    """用例 YAML 引用的外部变量名：${KEY}（普通）和 ${{KEY}}（密钥）。

    用例自己顶层 variables: 里定义的不算 —— 那些不需要环境提供。
    """
    local: set[str] = set()
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError:
        # 语法错误在保存用例时已拦过；这里只做尽力而为的提取
        doc = None
    if isinstance(doc, dict) and isinstance(doc.get("variables"), dict):
        local = {str(key) for key in doc["variables"]}
    return {plain or secret for plain, secret in _VAR_REF.findall(text)} - local


RANDOM_STRING_CHARS = string.ascii_letters + string.digits
RANDOM_NUMBER_CHARS = string.digits
RANDOM_MODES = frozenset({"random_string", "random_number"})
MAX_RANDOM_LENGTH = 128
DEFAULT_RANDOM_LENGTH = 8


def generate_random_value(
    mode: str, length: int, *, choice: Callable[[str], str] = secrets.choice
) -> str:
    """生成一次执行用的随机值；choice 可注入，测试用固定序列。"""
    if mode not in RANDOM_MODES:
        raise ValueError(f"未知随机变量类型：{mode}")
    if not 1 <= length <= MAX_RANDOM_LENGTH:
        raise ValueError(f"随机变量长度必须在 1-{MAX_RANDOM_LENGTH} 之间")
    alphabet = RANDOM_NUMBER_CHARS if mode == "random_number" else RANDOM_STRING_CHARS
    return "".join(choice(alphabet) for _ in range(length))


async def load_environment_variables(
    db: AsyncSession, environment_id: uuid.UUID
) -> tuple[dict[str, str], dict[str, str]]:
    """返回 (普通变量, 密钥变量)。密钥只在这里解密，调用方不得记录其值。

    随机变量在每次调用时生成一份新值；worker 每个 run 只调用一次，
    所以同一个 run 内所有步骤共用，重试/新 run 会重新生成。
    """
    rows = list(
        (
            await db.execute(
                select(ProjectEnvironmentVariable).where(
                    ProjectEnvironmentVariable.environment_id == environment_id
                )
            )
        ).scalars()
    )
    plain: dict[str, str] = {}
    secret: dict[str, str] = {}
    for row in rows:
        if row.value_mode in RANDOM_MODES:
            try:
                value = generate_random_value(
                    row.value_mode, row.random_length or DEFAULT_RANDOM_LENGTH
                )
            except ValueError as exc:
                raise RuntimeError(
                    f"环境变量 {row.key} 的随机配置无效：{exc}"
                ) from exc
            if row.is_secret:
                secret[row.key] = value
            else:
                plain[row.key] = value
            continue
        value = row.value or ""
        if row.is_secret:
            secret[row.key] = decrypt_secret(value) if value else ""
        else:
            plain[row.key] = value
    return plain, secret
