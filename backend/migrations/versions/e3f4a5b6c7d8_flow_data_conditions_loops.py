"""flow data passing, conditions and loops

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB()


def upgrade() -> None:
    op.add_column("case_flow_nodes", sa.Column("condition", JSONB, nullable=True))
    op.add_column(
        "case_flow_nodes",
        sa.Column(
            "repeat_count", sa.Integer(), nullable=False, server_default=sa.text("1")
        ),
    )
    op.add_column("task_cases", sa.Column("condition", JSONB, nullable=True))
    op.add_column(
        "task_cases",
        sa.Column(
            "repeat_count", sa.Integer(), nullable=False, server_default=sa.text("1")
        ),
    )

    op.add_column("runs", sa.Column("flow_inputs", JSONB, nullable=True))
    op.add_column("runs", sa.Column("flow_outputs", JSONB, nullable=True))
    op.add_column(
        "runs",
        sa.Column(
            "flow_inputs_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column("runs", sa.Column("condition", JSONB, nullable=True))
    op.add_column("runs", sa.Column("condition_passed", sa.Boolean(), nullable=True))
    op.add_column("runs", sa.Column("loop_index", sa.Integer(), nullable=True))
    op.add_column("runs", sa.Column("loop_total", sa.Integer(), nullable=True))

    op.drop_constraint("ck_runs_status", "runs", type_="check")
    op.create_check_constraint(
        "ck_runs_status",
        "runs",
        "status IN ('queued', 'preparing', 'running', 'parsing', 'succeeded', "
        "'failed', 'cancelled', 'timed_out', 'blocked', 'skipped')",
    )


def downgrade() -> None:
    op.execute("UPDATE runs SET status = 'failed' WHERE status = 'skipped'")
    op.drop_constraint("ck_runs_status", "runs", type_="check")
    op.create_check_constraint(
        "ck_runs_status",
        "runs",
        "status IN ('queued', 'preparing', 'running', 'parsing', 'succeeded', "
        "'failed', 'cancelled', 'timed_out', 'blocked')",
    )

    op.drop_column("runs", "loop_total")
    op.drop_column("runs", "loop_index")
    op.drop_column("runs", "condition_passed")
    op.drop_column("runs", "condition")
    op.drop_column("runs", "flow_inputs_ready")
    op.drop_column("runs", "flow_outputs")
    op.drop_column("runs", "flow_inputs")
    op.drop_column("task_cases", "repeat_count")
    op.drop_column("task_cases", "condition")
    op.drop_column("case_flow_nodes", "repeat_count")
    op.drop_column("case_flow_nodes", "condition")