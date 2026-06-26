"""Local user extension over Supabase Auth. `id` = supabase auth.users.id."""

from __future__ import annotations

import uuid

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import CITEXT, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)
    plan: Mapped[str] = mapped_column(String(16), default="free", index=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), index=True)
    role: Mapped[str] = mapped_column(String(16), default="user")
    requests_used: Mapped[int] = mapped_column(default=0)
    requests_limit: Mapped[int] = mapped_column(default=1000)
