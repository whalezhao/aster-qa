"""case flow versions and canvas positions

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column(
        "case_flows",
        sa.Column(
            "current_version_no",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column("case_flow_nodes", sa.Column("position_x", sa.Float(), nullable=True))
    op.add_column("case_flow_nodes", sa.Column("position_y", sa.Float(), nullable=True))

    op.create_table(
        "case_flow_versions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "flow_id",
            UUID,
            sa.ForeignKey("case_flows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column(
            "nodes",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "edges",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "change_source",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'manual'"),
        ),
        sa.Column("change_note", sa.Text()),
        sa.Column(
            "created_by",
            UUID,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "flow_id", "version_no", name="uq_case_flow_versions_no"
        ),
        sa.CheckConstraint(
            "change_source IN ('create', 'manual', 'rollback')",
            name="ck_case_flow_versions_source",
        ),
    )
    op.create_index(
        "ix_case_flow_versions_flow",
        "case_flow_versions",
        ["flow_id", "version_no"],
    )


def downgrade() -> None:
    op.drop_index("ix_case_flow_versions_flow", table_name="case_flow_versions")
    op.drop_table("case_flow_versions")
    op.drop_column("case_flow_nodes", "position_y")
    op.drop_column("case_flow_nodes", "position_x")
    op.drop_column("case_flows", "current_version_no")