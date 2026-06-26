"""Per-agent idempotency log. Composite PK (event_id, agent_name)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProcessedEvent(Base):
    __tablename__ = "processed_events"
    __table_args__ = (PrimaryKeyConstraint("event_id", "agent_name", name="pk_processed_events"),)

    event_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    agent_name: Mapped[str] = mapped_column(String(64))
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
