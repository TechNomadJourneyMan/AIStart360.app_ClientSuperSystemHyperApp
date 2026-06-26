"""User alert rules + fired events + pending (quiet-hours deferred) alerts."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, time

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Text, Time, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ChannelKind(str, enum.Enum):
    """Delivery channel kinds — see Track C spec."""

    EMAIL = "EMAIL"
    TELEGRAM = "TELEGRAM"
    SLACK = "SLACK"
    DISCORD = "DISCORD"
    WEBHOOK = "WEBHOOK"


class AlertRule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "alert_rules"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    filter: Mapped[dict] = mapped_column(JSONB, nullable=False)
    channels: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Track C: single-channel delivery + quiet hours.
    quiet_hours_start: Mapped[time | None] = mapped_column(Time(), nullable=True)
    quiet_hours_end: Mapped[time | None] = mapped_column(Time(), nullable=True)
    timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="Asia/Almaty"
    )
    channel_kind: Mapped[ChannelKind | None] = mapped_column(
        Enum(
            ChannelKind,
            name="alert_channel_kind",
            values_callable=lambda obj: [e.value for e in obj],
            native_enum=True,
        ),
        nullable=True,
    )
    # For WEBHOOK channel, ``channel_config["secret"]`` is the sha256 hex
    # digest of the secret — plaintext is returned ONCE on creation only.
    channel_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class AlertEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "alert_events"

    rule_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), index=True
    )
    aggregate_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), index=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PendingAlert(Base, UUIDPrimaryKeyMixin):
    """Alerts deferred because the rule was in quiet hours at dispatch time."""

    __tablename__ = "pending_alerts"

    rule_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("alert_rules.id", ondelete="CASCADE"),
        index=True,
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
