"""session config: bind to environment

Revision ID: a2b3c4d5e6f7
Revises: f0e1d2c3b4a5
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a2b3c4d5e6f7"
down_revision = "f0e1d2c3b4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 配置从项目级调整为环境级；旧表尚未上线，直接重建。
    op.drop_table("project_session_configs")
    op.create_table(
        "project_session_configs",
        sa.Column("environment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("login_case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("check_case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False, server_default="1800"),
        sa.Column(
            "retry_on_expiry", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["environment_id"], ["project_environments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["login_case_id"], ["test_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["check_case_id"], ["test_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "ttl_seconds BETWEEN 60 AND 86400",
            name="ck_project_session_configs_ttl",
        ),
        sa.PrimaryKeyConstraint("environment_id"),
    )
    op.create_index(
        "ix_project_session_configs_project",
        "project_session_configs",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_project_session_configs_project", table_name="project_session_configs"
    )
    op.drop_table("project_session_configs")
    op.create_table(
        "project_session_configs",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("login_case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("check_case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False, server_default="1800"),
        sa.Column(
            "retry_on_expiry", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["login_case_id"], ["test_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["check_case_id"], ["test_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "ttl_seconds BETWEEN 60 AND 86400",
            name="ck_project_session_configs_ttl",
        ),
        sa.PrimaryKeyConstraint("project_id"),
    )