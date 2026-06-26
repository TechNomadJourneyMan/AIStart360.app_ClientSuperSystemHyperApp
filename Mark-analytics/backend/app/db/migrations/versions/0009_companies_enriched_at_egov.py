"""Track G PR #8 — egov.kz on-demand enrichment timestamp.

Spec: docs/aistart360/07-product-redesign.md §6 Source 3 + §11 PR #8

Adds a single nullable column `companies.enriched_at_egov` so the Arq task
can skip companies that were enriched from egov.kz within the last 30 days.

Revision ID: 0009
Revises: 0006
Create Date: 2026-05-28
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
# 0007 / 0008 are reserved for the C1 CDC track in a parallel worktree but
# may not have landed yet — chain to the last known applied revision so this
# migration is independently runnable.
down_revision: str | None = "0006"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("enriched_at_egov", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_companies_enriched_at_egov",
        "companies",
        ["enriched_at_egov"],
        postgresql_where=sa.text("enriched_at_egov IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_companies_enriched_at_egov", table_name="companies")
    op.drop_column("companies", "enriched_at_egov")
