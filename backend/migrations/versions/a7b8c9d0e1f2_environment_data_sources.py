"""environment-scoped database data sources

Revision ID: a7b8c9d0e1f2
Revises: a2b3c4d5e6f7
"""

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "environment_data_sources",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("environment_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("dialect", sa.String(length=16), nullable=False, server_default="mysql"),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="3306"),
        sa.Column("database", sa.String(length=128), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("password", sa.Text(), nullable=False),
        sa.Column("ssl", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("charset", sa.String(length=32), nullable=False, server_default="utf8mb4"),
        sa.Column(
            "connect_timeout_ms", sa.Integer(), nullable=False, server_default="5000"
        ),
        sa.Column(
            "statement_timeout_ms", sa.Integer(), nullable=False, server_default="5000"
        ),
        sa.Column("max_rows", sa.Integer(), nullable=False, server_default="100"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "dialect IN ('mysql', 'oceanbase')",
            name="ck_environment_data_sources_dialect",
        ),
        sa.ForeignKeyConstraint(
            ["environment_id"], ["project_environments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "environment_id", "name", name="uq_environment_data_sources_name"
        ),
    )
    op.create_index(
        "ix_environment_data_sources_env",
        "environment_data_sources",
        ["environment_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_environment_data_sources_env", table_name="environment_data_sources"
    )
    op.drop_table("environment_data_sources")