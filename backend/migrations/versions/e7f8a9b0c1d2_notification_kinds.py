"""notification channel kinds

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-10-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, Sequence[str], None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "webhooks",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="generic"),
    )
    op.create_check_constraint(
        "ck_webhooks_kind",
        "webhooks",
        "kind IN ('generic', 'wecom', 'feishu', 'dingtalk', 'slack')",
    )
    op.alter_column("webhooks", "secret", existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE webhooks SET secret = '' WHERE secret IS NULL")
    op.alter_column("webhooks", "secret", existing_type=sa.String(length=255), nullable=False)
    op.drop_constraint("ck_webhooks_kind", "webhooks", type_="check")
    op.drop_column("webhooks", "kind")
