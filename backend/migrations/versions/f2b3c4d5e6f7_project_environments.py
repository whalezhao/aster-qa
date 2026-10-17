"""project environments and run environment snapshots

Revision ID: f2b3c4d5e6f7
Revises: e1a2b3c4d5e6
Create Date: 2026-10-18 09:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "e1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_environments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_project_environments_name"),
    )
    op.create_index(
        "ix_project_environments_project",
        "project_environments",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "uq_project_environments_default",
        "project_environments",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "project_environment_variables",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("environment_id", sa.UUID(), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("is_secret", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["environment_id"], ["project_environments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "environment_id", "key", name="uq_project_environment_variables_key"
        ),
    )
    op.create_index(
        "ix_project_environment_variables_env",
        "project_environment_variables",
        ["environment_id"],
        unique=False,
    )

    op.add_column(
        "test_tasks", sa.Column("environment_name", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "run_batches", sa.Column("environment_name", sa.String(length=64), nullable=True)
    )
    op.add_column("runs", sa.Column("environment_id", sa.UUID(), nullable=True))
    op.add_column("runs", sa.Column("environment_name", sa.String(length=64), nullable=True))
    op.add_column(
        "runs", sa.Column("environment_base_url", sa.String(length=512), nullable=True)
    )
    op.create_foreign_key(
        "fk_runs_environment_id",
        "runs",
        "project_environments",
        ["environment_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 每个项目补一个「默认」环境，地址沿用原来的 Project.base_url。
    # NOT EXISTS 保证重复执行也不会插第二条。
    op.execute(
        """
        INSERT INTO project_environments
            (id, project_id, name, base_url, is_default, created_at, updated_at)
        SELECT gen_random_uuid(), p.id, '默认', p.base_url, true, now(), now()
        FROM projects p
        WHERE NOT EXISTS (
            SELECT 1 FROM project_environments e
            WHERE e.project_id = p.id AND e.is_default
        )
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_runs_environment_id", "runs", type_="foreignkey")
    op.drop_column("runs", "environment_base_url")
    op.drop_column("runs", "environment_name")
    op.drop_column("runs", "environment_id")
    op.drop_column("run_batches", "environment_name")
    op.drop_column("test_tasks", "environment_name")
    op.drop_index(
        "ix_project_environment_variables_env",
        table_name="project_environment_variables",
    )
    op.drop_table("project_environment_variables")
    op.drop_index("uq_project_environments_default", table_name="project_environments")
    op.drop_index("ix_project_environments_project", table_name="project_environments")
    op.drop_table("project_environments")
