"""AI Digest subscriptions + run history.

Track B of `docs/aistart360/08-world-monitor-feature-parity.md` §5.

Notes for the merger:
- `filter_ref` is a free-text string until Track F's `saved_lists` table
  lands. It carries identifiers like ``"list:<uuid>"`` or
  ``"filter:<uuid>"`` and is resolved by the runtime resolver that ships
  alongside Track F. Today, the digest service treats any unknown
  ref as an empty match — the cron loop runs, the digest stays empty,
  and (per `send_when_empty`) is either dispatched as an empty-state
  message or skipped.
- `channel_kind` mirrors what Track C's `Deliverer` registry will expose
  (slack, discord, webhook, email, telegram). We accept the values here
  but do NOT depend on Track C — the dispatch step uses the thin local
  `DigestDeliverer` protocol declared in `app.services.digest`.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class DigestChannelKind(enum.StrEnum):
    EMAIL = "email"
    SLACK = "slack"
    DISCORD = "discord"
    TELEGRAM = "telegram"
    WEBHOOK = "webhook"


class DigestRunStatus(enum.StrEnum):
    SUCCESS = "success"
    EMPTY = "empty"
    ERROR = "error"


class DigestSubscription(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "digest_subscriptions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # Stub reference to a Track-F saved list or a filter snapshot.
    # Format: "list:<uuid>" or "filter:<uuid>". Resolver lives outside this PR.
    filter_ref: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="Digest")
    channel_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DigestChannelKind.EMAIL.value
    )
    channel_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    schedule_cron: Mapped[str] = mapped_column(Text, nullable=False)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="Asia/Almaty", default="Asia/Almaty"
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # When the ranked window is empty: emit an empty-state message (True)
    # or quietly skip the run (False). Per spec §5 Track B.
    send_when_empty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class DigestRun(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "digest_runs"

    subscription_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("digest_subscriptions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DigestRunStatus.SUCCESS.value
    )
    error: Mapped[str | None] = mapped_column(Text)
