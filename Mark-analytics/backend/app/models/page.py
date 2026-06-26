"""Page = one fetched URL snapshot. Metadata in PG, raw HTML in R2."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ARRAY, DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class Page(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "pages"
    __table_args__ = (
        UniqueConstraint("url_hash", "fetched_at", name="uq_pages_urlhash_fetched"),
    )

    url: Mapped[str] = mapped_column(Text, nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    http_status: Mapped[int | None] = mapped_column()
    content_type: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    html_r2_key: Mapped[str | None] = mapped_column(Text)
    screenshot_r2_key: Mapped[str | None] = mapped_column(Text)
    extraction_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    extracted_entities: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(PG_UUID(as_uuid=True)))
