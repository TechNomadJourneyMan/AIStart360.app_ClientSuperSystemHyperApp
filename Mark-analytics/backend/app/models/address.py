"""Address. `geo` PostGIS column added via raw SQL in migration (not mapped here)."""

from __future__ import annotations

from sqlalchemy import String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class Address(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "addresses"
    __table_args__ = (
        UniqueConstraint("country", "normalized", name="uq_addresses_country_normalized"),
    )

    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized: Mapped[str | None] = mapped_column(Text, index=True)
    country: Mapped[str | None] = mapped_column(String(2), index=True)
    region: Mapped[str | None] = mapped_column(Text, index=True)
    city: Mapped[str | None] = mapped_column(Text, index=True)
    street: Mapped[str | None] = mapped_column(Text)
    house: Mapped[str | None] = mapped_column(Text)
    postal_code: Mapped[str | None] = mapped_column(String(16))
