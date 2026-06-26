"""Persisted news items.

The RSS aggregator (`app.services.news_aggregator`) write-throughs into this
table on every successful refresh so `/api/v1/news/recent` can serve stored
items when upstream feeds fail or the in-process cache is cold.

`id` is the stable SHA-1 of the canonical URL (same hash the aggregator already
computes for the in-memory `NewsItem` dataclass), stored as text — not a UUID —
so write-through upserts are idempotent across restarts. `url` carries a unique
constraint to back the `ON CONFLICT (url) DO UPDATE` write path.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NewsItemRecord(Base):
    __tablename__ = "news_items"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    summary: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    tags: Mapped[list[Any] | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
