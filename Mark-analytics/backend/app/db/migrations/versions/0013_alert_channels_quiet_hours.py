"""Track C: multi-channel alert delivery + quiet hours.

Adds to ``alert_rules``:
    - ``quiet_hours_start`` / ``quiet_hours_end`` (time, nullable)
    - ``timezone`` (text, default ``"Asia/Almaty"``)
    - ``channel_kind`` (enum: EMAIL/TELEGRAM/SLACK/DISCORD/WEBHOOK, nullable for
      backward compat with the existing per-rule ``channels`` JSONB list — new
      single-channel API uses this column)
    - ``channel_config`` (jsonb, nullable) — per-channel config; for WEBHOOK
      the ``secret`` is stored hashed (sha256 hex) and is returned in plaintext
      ONCE on create.

Adds ``pending_alerts`` table for quiet-hours deferred delivery.

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-28
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


CHANNEL_KIND_NAME = "alert_channel_kind"
CHANNEL_KINDS = ("EMAIL", "TELEGRAM", "SLACK", "DISCORD", "WEBHOOK")


def upgrade() -> None:
    channel_kind = postgresql.ENUM(
        *CHANNEL_KINDS, name=CHANNEL_KIND_NAME, create_type=False
    )
    channel_kind.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "alert_rules",
        sa.Column("quiet_hours_start", sa.Time(), nullable=True),
    )
    op.add_column(
        "alert_rules",
        sa.Column("quiet_hours_end", sa.Time(), nullable=True),
    )
    op.add_column(
        "alert_rules",
        sa.Column(
            "timezone",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'Asia/Almaty'"),
        ),
    )
    op.add_column(
        "alert_rules",
        sa.Column(
            "channel_kind",
            postgresql.ENUM(
                *CHANNEL_KINDS, name=CHANNEL_KIND_NAME, create_type=False
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "alert_rules",
        sa.Column("channel_config", postgresql.JSONB(), nullable=True),
    )

    op.create_table(
        "pending_alerts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "rule_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("alert_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "scheduled_for",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_pending_alerts_scheduled_for",
        "pending_alerts",
        ["scheduled_for"],
    )
    op.create_index(
        "ix_pending_alerts_rule_id",
        "pending_alerts",
        ["rule_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pending_alerts_rule_id", table_name="pending_alerts")
    op.drop_index(
        "ix_pending_alerts_scheduled_for", table_name="pending_alerts"
    )
    op.drop_table("pending_alerts")

    op.drop_column("alert_rules", "channel_config")
    op.drop_column("alert_rules", "channel_kind")
    op.drop_column("alert_rules", "timezone")
    op.drop_column("alert_rules", "quiet_hours_end")
    op.drop_column("alert_rules", "quiet_hours_start")

    channel_kind = postgresql.ENUM(*CHANNEL_KINDS, name=CHANNEL_KIND_NAME)
    channel_kind.drop(op.get_bind(), checkfirst=True)
