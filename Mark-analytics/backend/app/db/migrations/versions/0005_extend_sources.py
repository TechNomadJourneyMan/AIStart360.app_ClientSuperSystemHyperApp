"""Extend `sources` table with metadata for free-tier API registry.

Adds: auth_type, free_tier_limits, docs_url, response_format, geo_scope,
category, priority, last_health_check, health_status, notes.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-28
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
# Phase 0 said 0004 was head. If a parallel agent lands 0004 in this branch,
# adjust this string accordingly during merge — see notes in the seed PR.
down_revision: str | None = "0004"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sources",
        sa.Column("auth_type", sa.String(32), nullable=True),
    )
    op.add_column("sources",
        sa.Column("free_tier_limits", postgresql.JSONB(), nullable=True),
    )
    op.add_column("sources",
        sa.Column("docs_url", sa.String(512), nullable=True),
    )
    op.add_column("sources",
        sa.Column("response_format", sa.String(32), nullable=True),
    )
    op.add_column("sources",
        sa.Column("geo_scope", sa.String(64), nullable=True),
    )
    op.add_column("sources",
        sa.Column("category", sa.String(64), nullable=True),
    )
    op.add_column("sources",
        sa.Column("priority", sa.SmallInteger(), nullable=False, server_default="5"),
    )
    op.add_column("sources",
        sa.Column("last_health_check", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("sources",
        sa.Column("health_status", sa.String(32), nullable=True),
    )
    op.add_column("sources",
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_index(
        "ix_sources_category_enabled_priority",
        "sources",
        ["category", "enabled", "priority"],
    )


def downgrade() -> None:
    op.drop_index("ix_sources_category_enabled_priority", table_name="sources")
    for col in [
        "notes",
        "health_status",
        "last_health_check",
        "priority",
        "category",
        "geo_scope",
        "response_format",
        "docs_url",
        "free_tier_limits",
        "auth_type",
    ]:
        op.drop_column("sources", col)
