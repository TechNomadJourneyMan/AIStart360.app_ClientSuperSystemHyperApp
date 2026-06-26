"""news_items — persisted RSS news for read-through fallback.

The RSS aggregator (`app.services.news_aggregator`) write-throughs into this
table on every successful refresh; `/api/v1/news/recent` reads from it when
upstream feeds fail or the in-process cache is cold.

`id` is the stable SHA-1 of the canonical URL (text PK — the same hash the
aggregator already computes), so write-through upserts are idempotent across
restarts. `url` carries a unique constraint to back `ON CONFLICT (url) DO UPDATE`.

Guards are idempotent (IF NOT EXISTS) so the migration is safe to re-run and
tolerant of the table being created out-of-band.

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-11
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("news_items"):
        return

    op.create_table(
        "news_items",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tags", postgresql.JSONB(), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("url", name="uq_news_items_url"),
    )
    op.create_index(
        "ix_news_items_published_at",
        "news_items",
        [sa.text("published_at DESC")],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_news_items_published_at", table_name="news_items", if_exists=True)
    op.drop_table("news_items")
