"""Sanctions / compliance lists (OFAC, EU, UN, КЗ/РФ внутренние)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import ARRAY, Date, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class SanctionsEntry(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "sanctions_list"

    list_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    aliases: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    dob: Mapped[date | None] = mapped_column(Date)
    country: Mapped[str | None] = mapped_column(String(2), index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    raw: Mapped[dict | None] = mapped_column(JSONB)
