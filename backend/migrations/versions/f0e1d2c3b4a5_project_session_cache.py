"""project session cache and session retry lineage

Revision ID: f0e1d2c3b4a5
Revises: a9b8c7d6e5f4
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f0e1d2c3b4a5"
down_revision = "a9b8c7d6e5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
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

    op.create_table(
        "project_session_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("environment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("login_case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("login_case_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("base_url_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "refreshed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["environment_id"], ["project_environments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["login_case_id"], ["test_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["login_case_version_id"],
            ["test_case_versions.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "environment_id", name="uq_project_session_states_env"
        ),
    )
    op.create_index(
        "ix_project_session_states_project",
        "project_session_states",
        ["project_id"],
    )

    op.add_column(
        "runs",
        sa.Column("retry_of_run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_runs_retry_of_run",
        "runs",
        "runs",
        ["retry_of_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_runs_retry_of", "runs", ["retry_of_run_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_retry_of", table_name="runs")
    op.drop_constraint("fk_runs_retry_of_run", "runs", type_="foreignkey")
    op.drop_column("runs", "retry_of_run_id")
    op.drop_index(
        "ix_project_session_states_project", table_name="project_session_states"
    )
    op.drop_table("project_session_states")
    op.drop_table("project_session_configs")