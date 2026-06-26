"""Crawl source registry. Configures spiders, rate limits, refresh policy."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Source(Base):
    __tablename__ = "sources"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 'registry', 'catalog', 'news', 'tender', 'social', 'api', 'rss', 'scrape', 'dataset'
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    rate_limit_rpm: Mapped[int] = mapped_column(default=30)
    refresh_min_hours: Mapped[int] = mapped_column(default=168)
    refresh_max_hours: Mapped[int] = mapped_column(default=720)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # ── Extended registry metadata (migration 0005) ────────────────────
    # 'none' | 'api_key' | 'oauth' | 'registration'
    auth_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # {"requests_per_day": 1000, "requests_per_minute": 60, ...} or null
    free_tier_limits: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    docs_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # 'json' | 'xml' | 'csv' | 'rss' | 'html'
    response_format: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 'kz' | 'cis' | 'global' | 'regional'
    geo_scope: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 'macro' | 'markets' | 'tenders' | 'news' | 'sanctions' | 'geo' | 'weather'
    # | 'ownership' | 'trade' | 'patents' | 'jobs' | 'osint' | 'climate'
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 1 = critical, 10 = nice-to-have
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=5)
    last_health_check: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 'ok' | 'degraded' | 'down' | 'untested'
    health_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
