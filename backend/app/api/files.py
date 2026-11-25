"""项目测试文件库：上传、列表、下载、删除。

文件内容落在 API 与 worker 共享的 assets 目录，数据库只存元数据。所有磁盘路径
都由 UUID 生成，客户端传来的原始文件名只做展示和上传到被测页面时使用。
"""

import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from ..config import get_settings
from ..deps import CurrentUser, DbSession
from ..models import ProjectFile
from ..project_files import (
    ensure_allowed_suffix,
    project_assets_dir,
    resolve_storage_path,
    sanitize_filename,
    storage_relative_path,
    validate_file_key,
)
from ..schemas import ProjectFileOut, ProjectFilePageOut
from ..user_names import attach_user_names
from .environments import _require_env

router = APIRouter(tags=["project-files"])
log = logging.getLogger("project-files")

CHUNK_SIZE = 1024 * 1024


async def _require_file(
    db, environment_id: uuid.UUID, file_id: uuid.UUID
) -> ProjectFile:
    row = await db.get(ProjectFile, file_id)
    if row is None or row.environment_id != environment_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "测试文件不存在")
    return row


async def _out(db, row: ProjectFile) -> ProjectFileOut:
    await attach_user_names(db, [row])
    return ProjectFileOut.model_validate(row)


@router.get(
    "/api/environments/{environment_id}/files", response_model=ProjectFilePageOut
)
async def list_environment_files(
    environment_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ProjectFilePageOut:
    _env, _project = await _require_env(db, environment_id, user)
    total = (
        await db.execute(
            select(func.count(ProjectFile.id)).where(
                ProjectFile.environment_id == environment_id
            )
        )
    ).scalar_one()
    rows = list(
        (
            await db.execute(
                select(ProjectFile)
                .where(ProjectFile.environment_id == environment_id)
                .order_by(ProjectFile.key)
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    await attach_user_names(db, rows)
    return ProjectFilePageOut(
        items=[ProjectFileOut.model_validate(row) for row in rows],
        total=total,
    )


@router.post(
    "/api/environments/{environment_id}/files",
    response_model=ProjectFileOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_environment_file(
    environment_id: uuid.UUID,
    key: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    user: CurrentUser,
    db: DbSession,
    description: Annotated[str | None, Form()] = None,
    replace: Annotated[bool, Form()] = False,
) -> ProjectFileOut:
    env, project = await _require_env(db, environment_id, user)
    try:
        key = validate_file_key(key)
        original_name = sanitize_filename(file.filename or "file")
        ensure_allowed_suffix(original_name)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if description and len(description) > 255:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "描述不能超过 255 个字符")
    content_type = file.content_type

    settings = get_settings()
    existing = (
        await db.execute(
            select(ProjectFile).where(
                ProjectFile.environment_id == env.id, ProjectFile.key == key
            )
        )
    ).scalar_one_or_none()
    if existing is not None and not replace:
        raise HTTPException(status.HTTP_409_CONFLICT, f"文件 key「{key}」已存在")

    old_path: Path | None = None
    if existing is not None:
        try:
            old_path = resolve_storage_path(settings.assets_path, existing.storage_path)
        except ValueError:
            old_path = None

    used = (
        await db.execute(
            select(func.coalesce(func.sum(ProjectFile.size), 0)).where(
                ProjectFile.project_id == project.id
            )
        )
    ).scalar_one()
    if existing is not None:
        used -= existing.size

    file_id = uuid.uuid4()
    storage_path = storage_relative_path(project.team_id, project.id, file_id, original_name)
    target = resolve_storage_path(settings.assets_path, storage_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")

    size = 0
    digest = hashlib.sha256()
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"文件不能超过 {settings.max_upload_bytes // (1024 * 1024)} MB",
                    )
                if used + size > settings.max_project_assets_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        "该系统的测试文件总大小已超过限额",
                    )
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "不能上传空文件")
        os.replace(tmp, target)
    except Exception:
        tmp.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    if existing is not None:
        existing.original_name = original_name
        existing.content_type = content_type
        existing.size = size
        existing.sha256 = digest.hexdigest()
        existing.storage_path = storage_path
        existing.description = description
        existing.created_by = user.id
        row = existing
    else:
        row = ProjectFile(
            id=file_id,
            project_id=project.id,
            environment_id=env.id,
            key=key,
            original_name=original_name,
            content_type=content_type,
            size=size,
            sha256=digest.hexdigest(),
            storage_path=storage_path,
            description=description,
            created_by=user.id,
        )
        db.add(row)

    try:
        await db.commit()
        await db.refresh(row)
    except Exception:
        await db.rollback()
        target.unlink(missing_ok=True)
        raise

    if old_path is not None and old_path != target:
        old_path.unlink(missing_ok=True)
        try:
            old_path.parent.rmdir()
        except OSError:
            pass

    return await _out(db, row)


@router.get("/api/environments/{environment_id}/files/{file_id}")
async def download_environment_file(
    environment_id: uuid.UUID, file_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> FileResponse:
    await _require_env(db, environment_id, user)
    row = await _require_file(db, environment_id, file_id)
    settings = get_settings()
    try:
        target = resolve_storage_path(settings.assets_path, row.storage_path)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "测试文件不存在") from exc
    if not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "测试文件不存在")
    return FileResponse(
        target,
        media_type=row.content_type or "application/octet-stream",
        filename=row.original_name,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=0",
        },
    )


@router.delete(
    "/api/environments/{environment_id}/files/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_environment_file(
    environment_id: uuid.UUID,
    file_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> None:
    _env, project = await _require_env(db, environment_id, user, "admin")
    row = await _require_file(db, environment_id, file_id)
    settings = get_settings()
    path: Path | None = None
    try:
        path = resolve_storage_path(settings.assets_path, row.storage_path)
    except ValueError:
        log.warning("测试文件路径非法，跳过磁盘删除：%s", row.storage_path)
    await db.delete(row)
    await db.commit()
    if path is not None:
        path.unlink(missing_ok=True)
        try:
            path.parent.rmdir()
        except OSError:
            pass
        try:
            project_assets_dir(settings.assets_path, project.team_id, project.id).rmdir()
        except OSError:
            pass