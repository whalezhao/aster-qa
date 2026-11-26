"""环境数据库数据源的读取与探活。

密码只在执行链路里解密：worker 调用 `load_environment_data_sources` 后把结果放进
子进程环境，接口侧永远只回 `password_set`。
"""

import uuid

import asyncpg
import pymysql
import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .crypto import decrypt_secret
from .models import EnvironmentDataSource, ProjectEnvironment


def _connection_payload(row: EnvironmentDataSource) -> dict:
    return {
        "name": row.name,
        "dialect": row.dialect,
        "host": row.host,
        "port": row.port,
        "database": row.database,
        "username": row.username,
        "password": decrypt_secret(row.password) if row.password else "",
        "ssl": row.ssl,
        "charset": row.charset,
        "connectTimeoutMs": row.connect_timeout_ms,
        "statementTimeoutMs": row.statement_timeout_ms,
        "maxRows": row.max_rows,
    }


async def load_environment_data_sources(
    db: AsyncSession, environment_id: uuid.UUID
) -> dict[str, dict]:
    rows = list(
        (
            await db.execute(
                select(EnvironmentDataSource)
                .where(EnvironmentDataSource.environment_id == environment_id)
                .order_by(EnvironmentDataSource.name)
            )
        ).scalars()
    )
    return {row.name: _connection_payload(row) for row in rows}


async def project_data_sources(
    db: AsyncSession, project_id: uuid.UUID
) -> list[dict]:
    """给 AI 提示词和步骤编辑器用的元数据，不含连接密码。"""
    rows = (
        await db.execute(
            select(EnvironmentDataSource, ProjectEnvironment.name)
            .join(
                ProjectEnvironment,
                ProjectEnvironment.id == EnvironmentDataSource.environment_id,
            )
            .where(ProjectEnvironment.project_id == project_id)
            .order_by(ProjectEnvironment.name, EnvironmentDataSource.name)
        )
    ).all()
    return [
        {
            "name": row.name,
            "dialect": row.dialect,
            "environment_name": env_name,
        }
        for row, env_name in rows
    ]


def referenced_data_sources(yaml_texts: list[str]) -> set[str]:
    """扫描用例里引用的数据源名称，执行前先确认环境里确实配了。"""
    names: set[str] = set()
    for text in yaml_texts:
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError:
            continue
        if not isinstance(doc, dict):
            continue
        step_lists = [doc.get(key) for key in ("beforeAll", "beforeEach", "afterEach", "afterAll")]
        step_lists.extend(
            case.get("steps") for case in (doc.get("cases") or []) if isinstance(case, dict)
        )
        for steps in step_lists:
            if not isinstance(steps, list):
                continue
            for step in steps:
                if not isinstance(step, dict):
                    continue
                value = step.get("dbAssert")
                if isinstance(value, dict) and isinstance(value.get("datasource"), str):
                    name = value["datasource"].strip()
                    if name:
                        names.add(name)
    return names


def probe_connection(
    *,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    ssl: bool,
    charset: str,
    connect_timeout_ms: int,
) -> str | None:
    """同步探活，调用方用 asyncio.to_thread 执行。

    只执行 SELECT VERSION()，不碰业务表。
    """
    timeout = max(1, min(60, connect_timeout_ms // 1000 or 1))
    connection = pymysql.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=database,
        charset=charset or "utf8mb4",
        connect_timeout=timeout,
        read_timeout=timeout,
        write_timeout=timeout,
        ssl={} if ssl else None,
        autocommit=True,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            row = cursor.fetchone()
            return str(row[0]) if row and row[0] is not None else None
    finally:
        connection.close()


async def probe_postgres(
    *,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    ssl: bool,
    connect_timeout_ms: int,
) -> str | None:
    timeout = max(1, min(60, connect_timeout_ms // 1000 or 1))
    connection = await asyncpg.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=database,
        timeout=timeout,
        ssl=True if ssl else None,
    )
    try:
        version = await connection.fetchval("SELECT version()")
        return str(version) if version is not None else None
    finally:
        await connection.close()