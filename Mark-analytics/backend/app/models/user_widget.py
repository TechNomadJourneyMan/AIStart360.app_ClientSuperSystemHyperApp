"""Per-user dashboard widget records (Track G).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G —
"Per-user widgets storage".

`widget_type` references a key in `app.widgets.catalog.WIDGET_CATALOG`.
A CHECK constraint at the DB level enforces the enum so a bad type cannot
sneak in via a future code path that bypasses the service validator.

`params` is validated against the catalog JSON schema in the service layer
on every write (`app.services.widgets.create` / `update`).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

ALLOWED_WIDGET_TYPES = (
    "metric",
    "list",
    "chart",
    "map_mini",
    "news",
    "note",
)


class UserWidget(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_widgets"
    __table_args__ = (
        CheckConstraint(
            "widget_type IN ('metric','list','chart','map_mini','news','note')",
            name="widget_type_known",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    widget_type: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    layout: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    sort_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
