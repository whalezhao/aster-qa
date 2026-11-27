"""environment browser proxy url

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
"""

import sqlalchemy as sa
from alembic import op

revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_environments",
        sa.Column("proxy_url", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_environments", "proxy_url")