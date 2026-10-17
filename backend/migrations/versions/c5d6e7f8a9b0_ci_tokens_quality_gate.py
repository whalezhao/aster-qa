"""CI tokens and task quality gates

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-10-18 09:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, Sequence[str], None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "team_api_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("team_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_prefix", sa.String(length=24), nullable=False),
        sa.Column("scopes", sa.String(length=64), nullable=False, server_default="run,read"),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(token_hash) = 64", name="ck_team_api_tokens_hash"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_team_api_tokens_team", "team_api_tokens", ["team_id"], unique=False
    )

    op.add_column("run_batches", sa.Column("created_by_token_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_run_batches_created_by_token",
        "run_batches",
        "team_api_tokens",
        ["created_by_token_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("run_batches", sa.Column("gate_status", sa.String(length=16), nullable=True))
    op.add_column(
        "run_batches",
        sa.Column("gate_detail", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.add_column(
        "test_tasks",
        sa.Column("gate_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "test_tasks", sa.Column("gate_min_pass_rate", sa.Numeric(6, 4), nullable=True)
    )
    op.add_column(
        "test_tasks",
        sa.Column("gate_fail_on_p0", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint(
        "ck_test_tasks_gate_min_pass_rate",
        "test_tasks",
        "gate_min_pass_rate IS NULL OR (gate_min_pass_rate >= 0 AND gate_min_pass_rate <= 1)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_test_tasks_gate_min_pass_rate", "test_tasks", type_="check")
    op.drop_column("test_tasks", "gate_fail_on_p0")
    op.drop_column("test_tasks", "gate_min_pass_rate")
    op.drop_column("test_tasks", "gate_enabled")
    op.drop_column("run_batches", "gate_detail")
    op.drop_column("run_batches", "gate_status")
    op.drop_constraint(
        "fk_run_batches_created_by_token", "run_batches", type_="foreignkey"
    )
    op.drop_column("run_batches", "created_by_token_id")
    op.drop_index("ix_team_api_tokens_team", table_name="team_api_tokens")
    op.drop_table("team_api_tokens")
