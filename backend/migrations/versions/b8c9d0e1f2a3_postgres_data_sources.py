"""allow PostgreSQL environment data sources

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
"""

from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_environment_data_sources_dialect",
        "environment_data_sources",
        type_="check",
    )
    op.create_check_constraint(
        "ck_environment_data_sources_dialect",
        "environment_data_sources",
        "dialect IN ('mysql', 'oceanbase', 'postgres')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_environment_data_sources_dialect",
        "environment_data_sources",
        type_="check",
    )
    op.create_check_constraint(
        "ck_environment_data_sources_dialect",
        "environment_data_sources",
        "dialect IN ('mysql', 'oceanbase')",
    )