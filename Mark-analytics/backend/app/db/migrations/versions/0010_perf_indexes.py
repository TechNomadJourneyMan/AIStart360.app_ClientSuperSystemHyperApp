"""Sprint 5.2 perf pass — composite indexes for read-heavy endpoints.

Adds indexes identified by EXPLAIN ANALYZE on the BD-daily-driver queries:

- /companies list (cursor pagination by updated_at desc, common filters)
- /companies/{id} sub-resources (timeline, related tenders)
- /analytics/region-distribution + /analytics/country-distribution
- /geo/companies (bbox + region_kato + filters)

All indexes are added with IF NOT EXISTS so the migration is safe to re-run.
We use `CREATE INDEX CONCURRENTLY` where possible to avoid table locks in
production (requires running outside a transaction — handled via autocommit
block + isolation_level adjustment for online operation).

See docs/aistart360/09-performance-baseline-2026-05.md for before/after
EXPLAIN deltas.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-28

Note: 0007/0008 are reserved by a parallel track (C1 CDC) that hasn't
landed yet. We chain after 0009 — the migration runner will linearise
once 0007/0008 land.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


# ────────────────────────────────────────────────────────────────────
# Index DDL — written as raw SQL so we can use CONCURRENTLY and
# IF NOT EXISTS. Both are no-ops on re-run.
# ────────────────────────────────────────────────────────────────────

_UPGRADE_STATEMENTS: tuple[str, ...] = (
    # ── companies: cursor pagination on (updated_at DESC, id DESC),
    #    filtered by merged_into_id IS NULL.
    #    Partial index keeps it small (NULL = ~all rows alive).
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_companies_alive_updated
      ON companies (updated_at DESC, id DESC)
      WHERE merged_into_id IS NULL
    """,
    # ── companies: common filter combo (country, industry_code).
    #    Covers /companies?country=KZ&industry_code=... and
    #    industry/region distribution widgets.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_companies_country_industry
      ON companies (country, industry_code)
      WHERE merged_into_id IS NULL
    """,
    # ── companies: country + region_kato — analytics region drilldown.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_companies_country_region
      ON companies (country, region_kato)
      WHERE merged_into_id IS NULL AND region_kato IS NOT NULL
    """,
    # ── companies: country + status — overview/status_breakdown.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_companies_country_status
      ON companies (country, status)
      WHERE merged_into_id IS NULL
    """,
    # ── companies: size + employees for size_distribution + company_size derived filter.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_companies_size_employees
      ON companies (size_category, employee_count)
      WHERE merged_into_id IS NULL
    """,
    # ── tenders: per-company time-ordered lookup (related-tenders Q1).
    #    Two indexes since (customer_id, awarded_to_id) are independent.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tenders_customer_published
      ON tenders (customer_id, published_at DESC NULLS LAST)
      WHERE customer_id IS NOT NULL
    """,
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tenders_awarded_published
      ON tenders (awarded_to_id, published_at DESC NULLS LAST)
      WHERE awarded_to_id IS NOT NULL
    """,
    # ── companies_changes: per-company timeline (Q2). Backward index
    #    scan works but a composite is cheaper at scale.
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_companies_changes_company_time
      ON companies_changes (company_id, detected_at DESC)
    """,
)

_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    "DROP INDEX CONCURRENTLY IF EXISTS ix_companies_changes_company_time",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_tenders_awarded_published",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_tenders_customer_published",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_companies_size_employees",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_companies_country_status",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_companies_country_region",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_companies_country_industry",
    "DROP INDEX CONCURRENTLY IF EXISTS ix_companies_alive_updated",
)


def _run_outside_tx(statements: tuple[str, ...]) -> None:
    """CREATE INDEX CONCURRENTLY can't run inside a transaction block.

    We commit the current Alembic transaction, run each DDL in autocommit
    mode, then leave the connection ready for the next migration. If the
    backend doesn't support autocommit (e.g. SQLite in tests), we fall
    back to plain `op.execute` without CONCURRENTLY.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect != "postgresql":
        # Non-postgres: strip CONCURRENTLY and run inline (tests / sqlite).
        for sql in statements:
            op.execute(sql.replace(" CONCURRENTLY", ""))
        return

    # Postgres: each CONCURRENTLY DDL needs its own autocommit transaction.
    with op.get_context().autocommit_block():
        for sql in statements:
            op.execute(sql)


def upgrade() -> None:
    _run_outside_tx(_UPGRADE_STATEMENTS)


def downgrade() -> None:
    _run_outside_tx(_DOWNGRADE_STATEMENTS)
