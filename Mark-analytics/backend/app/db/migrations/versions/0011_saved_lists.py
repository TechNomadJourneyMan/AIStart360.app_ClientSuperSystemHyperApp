"""Saved Companies lists (Track F).

Adds:
  - saved_lists           (id, user_id, name, created_at, updated_at)
  - saved_list_items      ((list_id, company_id) PK, added_at, note)

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-28
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_lists",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_saved_lists_user_id_users"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
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
        sa.UniqueConstraint("user_id", "name", name="uq_saved_lists_user_id_name"),
    )
    op.create_index("ix_saved_lists_user_id", "saved_lists", ["user_id"])

    op.create_table(
        "saved_list_items",
        sa.Column(
            "list_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "saved_lists.id",
                ondelete="CASCADE",
                name="fk_saved_list_items_list_id_saved_lists",
            ),
            nullable=False,
        ),
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "companies.id",
                ondelete="CASCADE",
                name="fk_saved_list_items_company_id_companies",
            ),
            nullable=False,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("list_id", "company_id", name="pk_saved_list_items"),
    )
    op.create_index(
        "ix_saved_list_items_company_id", "saved_list_items", ["company_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_saved_list_items_company_id", table_name="saved_list_items")
    op.drop_table("saved_list_items")
    op.drop_index("ix_saved_lists_user_id", table_name="saved_lists")
    op.drop_table("saved_lists")
