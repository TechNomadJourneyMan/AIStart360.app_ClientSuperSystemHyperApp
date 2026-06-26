"""user_widgets — per-user dashboard widget records (Track G).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-28
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_widgets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("widget_type", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("layout", postgresql.JSONB(), nullable=True),
        sa.Column(
            "sort_index",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "widget_type IN ('metric','list','chart','map_mini','news','note')",
            name="ck_user_widgets_widget_type_known",
        ),
    )
    op.create_index(
        "ix_user_widgets_user_id",
        "user_widgets",
        ["user_id"],
    )
    op.create_index(
        "ix_user_widgets_user_id_sort_index",
        "user_widgets",
        ["user_id", "sort_index"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_widgets_user_id_sort_index", table_name="user_widgets")
    op.drop_index("ix_user_widgets_user_id", table_name="user_widgets")
    op.drop_table("user_widgets")
