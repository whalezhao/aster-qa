"""环境数据库数据源配置。"""

import asyncio
import time
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..crypto import decrypt_secret, encrypt_secret
from ..datasources import probe_connection, probe_postgres
from ..deps import CurrentUser, DbSession, require_project_access
from ..models import EnvironmentDataSource, ProjectEnvironment
from ..schemas import (
    DataSourceTestIn,
    DataSourceTestOut,
    EnvironmentDataSourceIn,
    EnvironmentDataSourceOut,
    ProjectDataSourceOut,
)

router = APIRouter(tags=["datasources"])


async def _require_env(db, environment_id: uuid.UUID, user, minimum: str = "member"):
    env = await db.get(ProjectEnvironment, environment_id)
    if env is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "环境不存在")
    await require_project_access(db, env.project_id, user, minimum)
    return env


def _out(row: EnvironmentDataSource) -> EnvironmentDataSourceOut:
    return EnvironmentDataSourceOut(
        id=row.id,
        environment_id=row.environment_id,
        name=row.name,
        dialect=row.dialect,
        host=row.host,
        port=row.port,
        database=row.database,
        username=row.username,
        ssl=row.ssl,
        charset=row.charset,
        connect_timeout_ms=row.connect_timeout_ms,
        statement_timeout_ms=row.statement_timeout_ms,
        max_rows=row.max_rows,
        password_set=bool(row.password),
    )


@router.get(
    "/api/environments/{environment_id}/datasources",
    response_model=list[EnvironmentDataSourceOut],
)
async def list_environment_data_sources(
    environment_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[EnvironmentDataSourceOut]:
    await _require_env(db, environment_id, user)
    rows = list(
        (
            await db.execute(
                select(EnvironmentDataSource)
                .where(EnvironmentDataSource.environment_id == environment_id)
                .order_by(EnvironmentDataSource.name)
            )
        ).scalars()
    )
    return [_out(row) for row in rows]


@router.get(
    "/api/projects/{project_id}/datasources",
    response_model=list[ProjectDataSourceOut],
)
async def list_project_data_sources(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[ProjectDataSourceOut]:
    await require_project_access(db, project_id, user)
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
        ProjectDataSourceOut(
            **_out(row).model_dump(),
            environment_name=env_name,
        )
        for row, env_name in rows
    ]


async def _ensure_unique_name(
    db,
    environment_id: uuid.UUID,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(EnvironmentDataSource.id).where(
        EnvironmentDataSource.environment_id == environment_id,
        EnvironmentDataSource.name == name,
    )
    if exclude_id is not None:
        stmt = stmt.where(EnvironmentDataSource.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "同名数据源已存在")


@router.post(
    "/api/environments/{environment_id}/datasources",
    response_model=EnvironmentDataSourceOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_data_source(
    environment_id: uuid.UUID,
    body: EnvironmentDataSourceIn,
    user: CurrentUser,
    db: DbSession,
) -> EnvironmentDataSourceOut:
    await _require_env(db, environment_id, user, "admin")
    password = (body.password or "").strip()
    if not password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "新建数据源必须填写密码")
    await _ensure_unique_name(db, environment_id, body.name)
    row = EnvironmentDataSource(
        environment_id=environment_id,
        name=body.name,
        dialect=body.dialect,
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=encrypt_secret(password),
        ssl=body.ssl,
        charset=body.charset,
        connect_timeout_ms=body.connect_timeout_ms,
        statement_timeout_ms=body.statement_timeout_ms,
        max_rows=body.max_rows,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.put(
    "/api/environments/{environment_id}/datasources/{data_source_id}",
    response_model=EnvironmentDataSourceOut,
)
async def update_data_source(
    environment_id: uuid.UUID,
    data_source_id: uuid.UUID,
    body: EnvironmentDataSourceIn,
    user: CurrentUser,
    db: DbSession,
) -> EnvironmentDataSourceOut:
    await _require_env(db, environment_id, user, "admin")
    row = await db.get(EnvironmentDataSource, data_source_id)
    if row is None or row.environment_id != environment_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "数据源不存在")
    await _ensure_unique_name(db, environment_id, body.name, exclude_id=row.id)
    row.name = body.name
    row.dialect = body.dialect
    row.host = body.host
    row.port = body.port
    row.database = body.database
    row.username = body.username
    password = (body.password or "").strip()
    if password:
        row.password = encrypt_secret(password)
    row.ssl = body.ssl
    row.charset = body.charset
    row.connect_timeout_ms = body.connect_timeout_ms
    row.statement_timeout_ms = body.statement_timeout_ms
    row.max_rows = body.max_rows
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.delete(
    "/api/environments/{environment_id}/datasources/{data_source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_data_source(
    environment_id: uuid.UUID,
    data_source_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    await _require_env(db, environment_id, user, "admin")
    row = await db.get(EnvironmentDataSource, data_source_id)
    if row is None or row.environment_id != environment_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "数据源不存在")
    await db.delete(row)
    await db.commit()


@router.post(
    "/api/environments/{environment_id}/datasources/test",
    response_model=DataSourceTestOut,
)
async def test_data_source(
    environment_id: uuid.UUID,
    body: DataSourceTestIn,
    user: CurrentUser,
    db: DbSession,
) -> DataSourceTestOut:
    await _require_env(db, environment_id, user, "admin")
    password = (body.password or "").strip()
    if body.id is not None:
        row = await db.get(EnvironmentDataSource, body.id)
        if row is None or row.environment_id != environment_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "数据源不存在")
        if not password:
            password = decrypt_secret(row.password) if row.password else ""
    if not password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "请填写数据库密码")

    started = time.monotonic()
    try:
        if body.dialect == "postgres":
            version = await probe_postgres(
                host=body.host,
                port=body.port,
                database=body.database,
                username=body.username,
                password=password,
                ssl=body.ssl,
                connect_timeout_ms=body.connect_timeout_ms,
            )
        else:
            version = await asyncio.to_thread(
                probe_connection,
                host=body.host,
                port=body.port,
                database=body.database,
                username=body.username,
                password=password,
                ssl=body.ssl,
                charset=body.charset,
                connect_timeout_ms=body.connect_timeout_ms,
            )
    except Exception as exc:  # noqa: BLE001 - 驱动异常类型很杂，统一转成人话
        detail = str(exc).replace(password, "***") if password else str(exc)
        return DataSourceTestOut(
            ok=False,
            message=f"连接失败：{type(exc).__name__}: {detail[:300]}",
        )
    return DataSourceTestOut(
        ok=True,
        latency_ms=int((time.monotonic() - started) * 1000),
        server_version=version,
    )