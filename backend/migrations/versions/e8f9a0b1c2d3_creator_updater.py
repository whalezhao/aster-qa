"""features/test_cases 增加修改人

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e8f9a0b1c2d3"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "features", sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_features_updated_by",
        "features",
        "users",
        ["updated_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "test_cases", sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_test_cases_updated_by",
        "test_cases",
        "users",
        ["updated_by"],
        ["id"],
        ondelete="SET NULL",
    )
    # 老数据没有修改记录；用创建人兜底，后续任何修改都会覆盖成真实修改人。
    op.execute("UPDATE features SET updated_by = created_by WHERE updated_by IS NULL")
    op.execute("UPDATE test_cases SET updated_by = created_by WHERE updated_by IS NULL")


def downgrade() -> None:
    op.drop_constraint("fk_test_cases_updated_by", "test_cases", type_="foreignkey")
    op.drop_column("test_cases", "updated_by")
    op.drop_constraint("fk_features_updated_by", "features", type_="foreignkey")
    op.drop_column("features", "updated_by")