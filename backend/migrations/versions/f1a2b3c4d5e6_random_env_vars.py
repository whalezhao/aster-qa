"""environment variables: add random generator mode and length

Revision ID: f1a2b3c4d5e6
Revises: e8f9a0b1c2d3
"""

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_environment_variables",
        sa.Column(
            "value_mode",
            sa.String(length=16),
            nullable=False,
            server_default="fixed",
        ),
    )
    op.add_column(
        "project_environment_variables",
        sa.Column("random_length", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_project_environment_variables_value_mode",
        "project_environment_variables",
        "value_mode IN ('fixed', 'random_string', 'random_number')",
    )
    op.create_check_constraint(
        "ck_project_environment_variables_random_length",
        "project_environment_variables",
        "(value_mode = 'fixed' AND random_length IS NULL)"
        " OR (value_mode <> 'fixed' AND random_length BETWEEN 1 AND 128)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_project_environment_variables_random_length",
        "project_environment_variables",
        type_="check",
    )
    op.drop_constraint(
        "ck_project_environment_variables_value_mode",
        "project_environment_variables",
        type_="check",
    )
    op.drop_column("project_environment_variables", "random_length")
    op.drop_column("project_environment_variables", "value_mode")