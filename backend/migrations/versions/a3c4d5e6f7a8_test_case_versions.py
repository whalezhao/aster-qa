"""test case version history

Revision ID: a3c4d5e6f7a8
Revises: f2b3c4d5e6f7
Create Date: 2026-10-18 09:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "f2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "test_case_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("case_id", sa.UUID(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("yaml_content", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(length=4), nullable=True),
        sa.Column("defect_ids", sa.String(length=255), nullable=True),
        sa.Column("stage_override", sa.String(length=16), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("change_source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "change_source IN ('create', 'manual', 'ai_fix', 'rollback', 'backfill')",
            name="ck_test_case_versions_source",
        ),
        sa.ForeignKeyConstraint(["case_id"], ["test_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_id", "version_no", name="uq_test_case_versions_no"),
    )
    op.create_index(
        "ix_test_case_versions_case",
        "test_case_versions",
        ["case_id", "version_no"],
        unique=False,
    )

    # 历史用例补 v1，时间沿用原用例的 updated_at
    op.execute(
        """
        INSERT INTO test_case_versions
            (id, case_id, version_no, name, description, yaml_content, priority,
             defect_ids, stage_override, is_active, change_source, change_note,
             created_by, created_at)
        SELECT gen_random_uuid(), c.id, 1, c.name, c.description, c.yaml_content,
               c.priority, c.defect_ids, c.stage_override, c.is_active, 'backfill',
               '初始版本', c.created_by, c.updated_at
        FROM test_cases c
        WHERE NOT EXISTS (
            SELECT 1 FROM test_case_versions v WHERE v.case_id = c.id
        )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_test_case_versions_case", table_name="test_case_versions")
    op.drop_table("test_case_versions")
