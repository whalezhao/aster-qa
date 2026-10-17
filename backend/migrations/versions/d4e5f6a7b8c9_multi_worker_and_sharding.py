"""multi-worker concurrency and run sharding

Revision ID: d4e5f6a7b8c9
Revises: b7d1e2f3a4c5
Create Date: 2026-10-17 21:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'b7d1e2f3a4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 全局并发上限：原 worker_concurrency 改名，语义从「每个 worker」变成「全局」
    op.alter_column(
        'app_settings',
        'worker_concurrency',
        new_column_name='max_concurrent_runs',
    )
    op.add_column(
        'app_settings',
        sa.Column('run_shard_size', sa.Integer(), nullable=False, server_default='4'),
    )

    op.add_column('runs', sa.Column('owner_worker_id', sa.String(length=64), nullable=True))
    op.add_column('runs', sa.Column('case_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('runs', sa.Column('shard_index', sa.Integer(), nullable=True))
    op.add_column('runs', sa.Column('shard_count', sa.Integer(), nullable=True))

    op.create_table(
        'worker_heartbeats',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('hostname', sa.String(length=255), nullable=True),
        sa.Column('pid', sa.Integer(), nullable=True),
        sa.Column('slots', sa.Integer(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('heartbeat_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('worker_heartbeats')
    op.drop_column('runs', 'shard_count')
    op.drop_column('runs', 'shard_index')
    op.drop_column('runs', 'case_ids')
    op.drop_column('runs', 'owner_worker_id')
    op.drop_column('app_settings', 'run_shard_size')
    op.alter_column(
        'app_settings',
        'max_concurrent_runs',
        new_column_name='worker_concurrency',
    )
