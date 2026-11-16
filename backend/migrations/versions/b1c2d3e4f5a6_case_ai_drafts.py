"""case ai drafts

Revision ID: b1c2d3e4f5a6
Revises: f9e8d7c6b5a4
Create Date: 2026-11-16 11:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "f9e8d7c6b5a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "case_ai_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("feature_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("state", postgresql.JSONB(), nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["test_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["feature_id"], ["features.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "(case_id IS NOT NULL) <> (feature_id IS NOT NULL)",
            name="ck_case_ai_drafts_target",
        ),
        sa.UniqueConstraint("user_id", "case_id", name="uq_case_ai_drafts_case"),
        sa.UniqueConstraint("user_id", "feature_id", name="uq_case_ai_drafts_feature"),
    )
    op.create_index("ix_case_ai_drafts_user", "case_ai_drafts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_case_ai_drafts_user", table_name="case_ai_drafts")
    op.drop_table("case_ai_drafts")