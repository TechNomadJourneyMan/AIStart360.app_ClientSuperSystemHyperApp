"""User-owned saved company lists (ICP / shortlists).

A `SavedList` is a named container, `SavedListItem` is the join row connecting a
list to a `Company` with an optional free-text note. Cascades:

  users.id  → saved_lists.user_id        (ON DELETE CASCADE)
  saved_lists.id → saved_list_items.list_id   (ON DELETE CASCADE)
  companies.id   → saved_list_items.company_id (ON DELETE CASCADE)

Sharing across users, folders, and AI-curated lists are explicitly out of scope
for this phase (see Track F spec, §5).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.company import Company


class SavedList(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "saved_lists"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_saved_lists_user_id_name"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    items: Mapped[list[SavedListItem]] = relationship(
        back_populates="parent_list",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class SavedListItem(Base):
    __tablename__ = "saved_list_items"

    list_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("saved_lists.id", ondelete="CASCADE"),
        primary_key=True,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text)

    parent_list: Mapped[SavedList] = relationship(back_populates="items")
    company: Mapped[Company] = relationship(lazy="joined")
