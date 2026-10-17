"""batch report signoff

Revision ID: b7d1e2f3a4c5
Revises: c68aefd108a7
Create Date: 2026-10-17 20:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d1e2f3a4c5'
down_revision: Union[str, Sequence[str], None] = 'c68aefd108a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'batch_report_signoffs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('batch_id', sa.UUID(), nullable=False),
        sa.Column('report_hash', sa.String(length=64), nullable=False),
        sa.Column('case_count', sa.Integer(), nullable=False),
        sa.Column('passed', sa.Integer(), nullable=False),
        sa.Column('failed', sa.Integer(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('signed_by', sa.UUID(), nullable=True),
        sa.Column('signed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_by', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(['batch_id'], ['run_batches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['signed_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['revoked_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_batch_report_signoffs_batch',
        'batch_report_signoffs',
        ['batch_id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_batch_report_signoffs_batch', table_name='batch_report_signoffs')
    op.drop_table('batch_report_signoffs')
