"""project files: bind to environment

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_files",
        sa.Column("environment_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_project_files_environment",
        "project_files",
        "project_environments",
        ["environment_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # 存量文件归到项目的默认环境；没有默认环境时取最早创建的环境。
    op.execute(
        """
        UPDATE project_files AS pf
        SET environment_id = (
            SELECT pe.id
            FROM project_environments AS pe
            WHERE pe.project_id = pf.project_id
            ORDER BY pe.is_default DESC, pe.created_at
            LIMIT 1
        )
        WHERE pf.environment_id IS NULL
        """
    )
    op.alter_column("project_files", "environment_id", nullable=False)

    op.drop_constraint("uq_project_files_key", "project_files", type_="unique")
    op.create_unique_constraint(
        "uq_project_files_environment_key",
        "project_files",
        ["environment_id", "key"],
    )
    op.create_index(
        "ix_project_files_environment", "project_files", ["environment_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_project_files_environment", table_name="project_files")
    op.drop_constraint(
        "uq_project_files_environment_key", "project_files", type_="unique"
    )
    op.create_unique_constraint(
        "uq_project_files_key", "project_files", ["project_id", "key"]
    )
    op.drop_constraint(
        "fk_project_files_environment", "project_files", type_="foreignkey"
    )
    op.drop_column("project_files", "environment_id")