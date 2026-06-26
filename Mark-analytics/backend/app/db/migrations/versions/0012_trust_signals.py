"""Trust signals: data_freshness_at + confidence_band cols + CDC change_source.

§11 PRs #1 + #2 + #5 of the redesign doc.

Reuses the existing `companies_changes` table created in 0001 — only adds the
`change_source` discriminator column required by the application-level event
listener. The numeric `confidence` column already on `companies` is left
intact; we add a separate `confidence_band` text enum for the trust-signals
envelope (`high|medium|low`).

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-28
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # ── companies: data_freshness_at + confidence_band ──────────────
    op.add_column(
        "companies",
        sa.Column("data_freshness_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column(
            "confidence_band",
            sa.String(8),
            nullable=False,
            server_default="medium",
        ),
    )
    op.create_check_constraint(
        "ck_companies_confidence_band",
        "companies",
        "confidence_band IN ('high','medium','low')",
    )
    # Backfill: align freshness with last known update timestamp.
    op.execute("UPDATE companies SET data_freshness_at = updated_at")

    # ── companies_changes: change_source discriminator ──────────────
    op.add_column(
        "companies_changes",
        sa.Column("change_source", sa.String(32), nullable=True),
    )

    # Helpful read pattern: recent_changes count by company over time window.
    op.create_index(
        "ix_companies_changes_company_detected_desc",
        "companies_changes",
        ["company_id", sa.text("detected_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_companies_changes_company_detected_desc",
        table_name="companies_changes",
    )
    op.drop_column("companies_changes", "change_source")
    op.drop_constraint("ck_companies_confidence_band", "companies", type_="check")
    op.drop_column("companies", "confidence_band")
    op.drop_column("companies", "data_freshness_at")
