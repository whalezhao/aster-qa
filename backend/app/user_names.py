"""给列表/详情补创建人、修改人的显示名。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User


async def attach_user_names(db: AsyncSession, items: list) -> None:
    items = [item for item in items if item is not None]
    if not items:
        return
    ids: set[uuid.UUID] = set()
    for item in items:
        if getattr(item, "created_by", None):
            ids.add(item.created_by)
        if getattr(item, "updated_by", None):
            ids.add(item.updated_by)
    if not ids:
        return
    rows = (
        await db.execute(
            select(User.id, User.username, User.display_name).where(User.id.in_(ids))
        )
    ).all()
    names = {row[0]: row[2] or row[1] for row in rows}
    for item in items:
        # 这些字段只给响应序列化用，不落库；RunBatch 只有 created_by
        item.created_by_name = names.get(getattr(item, "created_by", None))
        if hasattr(item, "updated_by"):
            item.updated_by_name = names.get(item.updated_by)