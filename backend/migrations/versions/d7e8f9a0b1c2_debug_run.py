"""debug runs: AI 面板的单步试跑

试跑的 YAML 直接挂在 run 上，不落 TestCase、不进批次，统计查询按 is_debug 排除。

Revision ID: d7e8f9a0b1c2
Revises: c3d4e5f6a7b8
"""

import sqlalchemy as sa
from alembic import op

revision = "d7e8f9a0b1c2"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("is_debug", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("runs", sa.Column("debug_yaml", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("debug_step_limit", sa.Integer(), nullable=True))
    op.add_column(
        "runs",
        sa.Column("debug_cache", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("runs", "debug_cache")
    op.drop_column("runs", "debug_step_limit")
    op.drop_column("runs", "debug_yaml")
    op.drop_column("runs", "is_debug")