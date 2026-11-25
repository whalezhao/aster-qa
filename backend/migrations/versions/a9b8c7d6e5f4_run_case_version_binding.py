"""runs: bind case results to the version executed

Revision ID: a9b8c7d6e5f4
Revises: b2c3d4e5f6a7
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a9b8c7d6e5f4"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("case_versions", postgresql.JSONB(), nullable=True))
    op.add_column(
        "case_results",
        sa.Column(
            "test_case_version_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "case_results",
        sa.Column("test_case_version_no", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_case_results_test_case_version",
        "case_results",
        "test_case_versions",
        ["test_case_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_case_results_version", "case_results", ["test_case_version_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_case_results_version", table_name="case_results")
    op.drop_constraint(
        "fk_case_results_test_case_version",
        "case_results",
        type_="foreignkey",
    )
    op.drop_column("case_results", "test_case_version_no")
    op.drop_column("case_results", "test_case_version_id")
    op.drop_column("runs", "case_versions")