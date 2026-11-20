"""feature hierarchy

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6
Create Date: 2026-11-20 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "features",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.drop_constraint("uq_features_project_name", "features", type_="unique")
    op.create_index("ix_features_parent", "features", ["parent_id"])
    # 顶层与子级分开做唯一索引：跨父级允许同名，同级仍唯一。
    op.create_index(
        "uq_features_root_name",
        "features",
        ["project_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )
    op.create_index(
        "uq_features_sibling_name",
        "features",
        ["project_id", "parent_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )
    op.create_foreign_key(
        "fk_features_parent",
        "features",
        "features",
        ["parent_id"],
        ["id"],
    )


def downgrade() -> None:
    # 有跨父级同名功能时会失败，属预期：回滚前需先合并/改名。
    op.drop_constraint("fk_features_parent", "features", type_="foreignkey")
    op.drop_index("uq_features_sibling_name", table_name="features")
    op.drop_index("uq_features_root_name", table_name="features")
    op.drop_index("ix_features_parent", table_name="features")
    op.create_unique_constraint(
        "uq_features_project_name", "features", ["project_id", "name"]
    )
    op.drop_column("features", "parent_id")