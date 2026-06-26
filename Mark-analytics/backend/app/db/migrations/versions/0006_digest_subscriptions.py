"""Track B — AI Digest subscriptions + runs.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track B

Adds two tables:
- digest_subscriptions: user-defined recurring digest config
- digest_runs: per-execution journal

`filter_ref` is plain text — Track F (saved lists) will provide the resolver.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-28
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "digest_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filter_ref", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default="Digest"),
        sa.Column(
            "channel_kind", sa.String(16), nullable=False, server_default="email"
        ),
        sa.Column(
            "channel_config",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("schedule_cron", sa.Text(), nullable=False),
        sa.Column(
            "timezone", sa.String(64), nullable=False, server_default="Asia/Almaty"
        ),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "send_when_empty",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_digest_subscriptions_user_id",
        "digest_subscriptions",
        ["user_id"],
    )
    op.create_index(
        "ix_digest_subscriptions_active_last_run",
        "digest_subscriptions",
        ["active", "last_run_at"],
    )

    op.create_table(
        "digest_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "subscription_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("digest_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "item_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "status", sa.String(16), nullable=False, server_default="success"
        ),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_digest_runs_subscription_id",
        "digest_runs",
        ["subscription_id"],
    )
    op.create_index(
        "ix_digest_runs_started_at",
        "digest_runs",
        ["started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_digest_runs_started_at", table_name="digest_runs")
    op.drop_index("ix_digest_runs_subscription_id", table_name="digest_runs")
    op.drop_table("digest_runs")
    op.drop_index(
        "ix_digest_subscriptions_active_last_run",
        table_name="digest_subscriptions",
    )
    op.drop_index(
        "ix_digest_subscriptions_user_id", table_name="digest_subscriptions"
    )
    op.drop_table("digest_subscriptions")
