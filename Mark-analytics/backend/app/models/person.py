"""Person entity (people in CIS business landscape)."""

from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

try:
    from pgvector.sqlalchemy import Vector  # type: ignore[import-untyped]
except ImportError:
    Vector = None  # type: ignore[assignment, misc]

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Person(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "persons"

    iin: Mapped[str | None] = mapped_column(String(12), index=True)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    name_normalized: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    country: Mapped[str | None] = mapped_column(String(2), index=True)
    role_history: Mapped[list[dict] | None] = mapped_column(JSONB)
    contacts: Mapped[dict | None] = mapped_column(JSONB)
    sanctions: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    raw: Mapped[dict | None] = mapped_column(JSONB)

    if Vector is not None:
        embedding: Mapped[list[float] | None] = mapped_column(Vector(1024))  # type: ignore[valid-type]
