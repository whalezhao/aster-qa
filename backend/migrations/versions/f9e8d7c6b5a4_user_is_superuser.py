"""user is_superuser

Revision ID: f9e8d7c6b5a4
Revises: e7f8a9b0c1d2
Create Date: 2026-11-16 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f9e8d7c6b5a4"
down_revision: str | Sequence[str] | None = "e7f8a9b0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_superuser", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # 内置 admin 一直是「超级管理员」，升级后保留它跨团队管理的身份
    op.execute("UPDATE users SET is_superuser = true WHERE username = 'admin'")


def downgrade() -> None:
    op.drop_column("users", "is_superuser")
