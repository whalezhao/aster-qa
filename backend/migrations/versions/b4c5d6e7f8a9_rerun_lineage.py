"""batch rerun lineage and new trigger sources

Revision ID: b4c5d6e7f8a9
Revises: a3c4d5e6f7a8
Create Date: 2026-10-18 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, Sequence[str], None] = "a3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("run_batches", sa.Column("parent_batch_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_run_batches_parent",
        "run_batches",
        "run_batches",
        ["parent_batch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_run_batches_parent",
        "run_batches",
        ["parent_batch_id"],
        unique=False,
    )

    op.drop_constraint("ck_run_batches_trigger", "run_batches", type_="check")
    op.create_check_constraint(
        "ck_run_batches_trigger",
        "run_batches",
        "trigger IN ('manual', 'regression', 'rerun', 'schedule', 'ci')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_run_batches_trigger", "run_batches", type_="check")
    op.create_check_constraint(
        "ck_run_batches_trigger",
        "run_batches",
        "trigger IN ('manual', 'regression')",
    )
    op.drop_index("ix_run_batches_parent", table_name="run_batches")
    op.drop_constraint("fk_run_batches_parent", "run_batches", type_="foreignkey")
    op.drop_column("run_batches", "parent_batch_id")
