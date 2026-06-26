"""User-uploaded files metadata. Raw bytes in R2/Supabase Storage."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserUpload(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_uploads"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column()
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="analyzing", index=True)
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    mapping_proposal: Mapped[dict | None] = mapped_column(JSONB)
    extracted_rows: Mapped[int | None] = mapped_column()
