"""case flow orchestration

Revision ID: c1d2e3f4a5b6
Revises: b8c9d0e1f2a3
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c1d2e3f4a5b6"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "case_flows",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "project_id",
            UUID,
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column(
            "created_by",
            UUID,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "updated_by",
            UUID,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
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
        sa.UniqueConstraint("project_id", "name", name="uq_case_flows_project_name"),
    )
    op.create_index("ix_case_flows_project", "case_flows", ["project_id"])

    op.create_table(
        "case_flow_nodes",
        sa.Column(
            "flow_id",
            UUID,
            sa.ForeignKey("case_flows.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "case_id",
            UUID,
            sa.ForeignKey("test_cases.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "position", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.create_index("ix_case_flow_nodes_case", "case_flow_nodes", ["case_id"])

    op.create_table(
        "case_flow_edges",
        sa.Column("flow_id", UUID, primary_key=True),
        sa.Column("case_id", UUID, primary_key=True),
        sa.Column("depends_on_case_id", UUID, primary_key=True),
        sa.ForeignKeyConstraint(
            ["flow_id", "case_id"],
            ["case_flow_nodes.flow_id", "case_flow_nodes.case_id"],
            ondelete="CASCADE",
            name="fk_case_flow_edges_case",
        ),
        sa.ForeignKeyConstraint(
            ["flow_id", "depends_on_case_id"],
            ["case_flow_nodes.flow_id", "case_flow_nodes.case_id"],
            ondelete="CASCADE",
            name="fk_case_flow_edges_dep",
        ),
        sa.CheckConstraint(
            "case_id <> depends_on_case_id", name="ck_case_flow_edges_no_self"
        ),
    )
    op.create_index(
        "ix_case_flow_edges_dep", "case_flow_edges", ["flow_id", "depends_on_case_id"]
    )

    op.create_table(
        "task_case_dependencies",
        sa.Column("task_id", UUID, primary_key=True),
        sa.Column("case_id", UUID, primary_key=True),
        sa.Column("depends_on_case_id", UUID, primary_key=True),
        sa.ForeignKeyConstraint(
            ["task_id", "case_id"],
            ["task_cases.task_id", "task_cases.case_id"],
            ondelete="CASCADE",
            name="fk_task_case_deps_case",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "depends_on_case_id"],
            ["task_cases.task_id", "task_cases.case_id"],
            ondelete="CASCADE",
            name="fk_task_case_deps_dep",
        ),
        sa.CheckConstraint(
            "case_id <> depends_on_case_id", name="ck_task_case_deps_no_self"
        ),
    )
    op.create_index(
        "ix_task_case_deps_dep",
        "task_case_dependencies",
        ["task_id", "depends_on_case_id"],
    )

    op.create_table(
        "run_dependencies",
        sa.Column(
            "run_id",
            UUID,
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "depends_on_run_id",
            UUID,
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.CheckConstraint(
            "run_id <> depends_on_run_id", name="ck_run_dependencies_no_self"
        ),
    )
    op.create_index(
        "ix_run_dependencies_dep", "run_dependencies", ["depends_on_run_id"]
    )

    op.add_column(
        "task_cases",
        sa.Column(
            "is_flow_node",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "runs",
        sa.Column(
            "run_kind",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'shard'"),
        ),
    )
    op.add_column(
        "case_results", sa.Column("blocked_reason", sa.String(255), nullable=True)
    )
    op.add_column(
        "project_session_states",
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.drop_constraint("ck_runs_status", "runs", type_="check")
    op.create_check_constraint(
        "ck_runs_status",
        "runs",
        "status IN ('queued', 'preparing', 'running', 'parsing', 'succeeded', "
        "'failed', 'cancelled', 'timed_out', 'blocked')",
    )
    op.create_check_constraint(
        "ck_runs_kind", "runs", "run_kind IN ('shard', 'flow', 'debug')"
    )


def downgrade() -> None:
    op.execute("UPDATE runs SET status = 'failed' WHERE status = 'blocked'")

    op.drop_constraint("ck_runs_kind", "runs", type_="check")
    op.drop_constraint("ck_runs_status", "runs", type_="check")
    op.create_check_constraint(
        "ck_runs_status",
        "runs",
        "status IN ('queued', 'preparing', 'running', 'parsing', 'succeeded', "
        "'failed', 'cancelled', 'timed_out')",
    )

    op.drop_column("project_session_states", "last_checked_at")
    op.drop_column("case_results", "blocked_reason")
    op.drop_column("runs", "run_kind")
    op.drop_column("task_cases", "is_flow_node")

    op.drop_index("ix_run_dependencies_dep", table_name="run_dependencies")
    op.drop_table("run_dependencies")
    op.drop_index("ix_task_case_deps_dep", table_name="task_case_dependencies")
    op.drop_table("task_case_dependencies")
    op.drop_index("ix_case_flow_edges_dep", table_name="case_flow_edges")
    op.drop_table("case_flow_edges")
    op.drop_index("ix_case_flow_nodes_case", table_name="case_flow_nodes")
    op.drop_table("case_flow_nodes")
    op.drop_index("ix_case_flows_project", table_name="case_flows")
    op.drop_table("case_flows")