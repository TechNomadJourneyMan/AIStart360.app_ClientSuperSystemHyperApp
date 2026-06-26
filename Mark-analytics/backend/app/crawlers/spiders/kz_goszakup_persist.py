"""Persistence helpers for the kz_goszakup HTML mirror spider.

Split from the spider module so the spider stays import-light (and unit-
testable without touching SQLAlchemy). Two responsibilities:

1. ``persist_pages``       — write fetched HTML metadata into ``pages``.
2. ``persist_tenders``     — upsert tenders by (source, external_id) and
                             optionally link to ``companies`` rows by BIN.

The spider's trust signals (``confidence``, ``data_freshness_at``) are
**feature-flagged**: ``Tender`` does not yet have those columns on this
branch, so we stash the values inside the ``raw`` JSONB payload. When the
C1 trust-signals migration lands the spider can move them to first-class
columns without changing the parser.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.crawlers.base import FetchedPage
from app.crawlers.spiders.kz_goszakup import TenderRecord
from app.models.company import Company
from app.models.page import Page
from app.models.tender import Tender

log = get_logger("crawler.kz_goszakup.persist")

SOURCE = "kz_goszakup"
SOURCE_CONFIDENCE = "high"


async def persist_pages(
    session: AsyncSession, fetched: list[FetchedPage]
) -> int:
    """Insert ``pages`` rows. Returns count inserted (best-effort, idempotent)."""

    if not fetched:
        return 0
    rows = [
        {
            "url": p.url,
            "url_hash": p.url_hash,
            "source": p.source,
            "http_status": p.http_status,
            "content_type": p.content_type,
            "fetched_at": p.fetched_at,
            "html_r2_key": p.html_r2_key,
            "extraction_status": "pending",
        }
        for p in fetched
    ]
    stmt = pg_insert(Page.__table__).values(rows)
    stmt = stmt.on_conflict_do_nothing(
        constraint="uq_pages_urlhash_fetched"
    )
    result = await session.execute(stmt)
    return result.rowcount or 0


async def persist_tenders(
    session: AsyncSession,
    tenders: list[TenderRecord],
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """Upsert tenders by ``(source, external_id)``. Returns counters."""

    if not tenders:
        return {"inserted": 0, "updated": 0, "linked_customer": 0, "linked_winner": 0}

    fresh = now or datetime.now(UTC)

    bins = {t.customer_bin_raw for t in tenders if t.customer_bin_raw}
    bins.update(t.winner_bin_raw for t in tenders if t.winner_bin_raw)
    bins.discard(None)
    bin_to_company_id = await _resolve_bins(session, bins)

    counters = {"inserted": 0, "updated": 0, "linked_customer": 0, "linked_winner": 0}

    for t in tenders:
        customer_id = bin_to_company_id.get(t.customer_bin_raw) if t.customer_bin_raw else None
        winner_id = bin_to_company_id.get(t.winner_bin_raw) if t.winner_bin_raw else None
        if customer_id:
            counters["linked_customer"] += 1
        if winner_id:
            counters["linked_winner"] += 1

        raw_payload: dict[str, Any] = dict(t.raw or {})
        # Feature-flagged trust signals — stash until C1 migration lands.
        raw_payload["customer_bin_raw"] = t.customer_bin_raw
        raw_payload["winner_bin_raw"] = t.winner_bin_raw
        raw_payload["customer_name"] = t.customer_name
        raw_payload["winner_name"] = t.winner_name
        raw_payload["procurement_type"] = t.procurement_type
        raw_payload["documents"] = list(t.documents or [])
        raw_payload["detail_url"] = t.detail_url
        raw_payload["confidence"] = SOURCE_CONFIDENCE
        raw_payload["data_freshness_at"] = fresh.isoformat()

        values = {
            "external_id": t.external_id,
            "source": SOURCE,
            "customer_id": customer_id,
            "awarded_to_id": winner_id,
            "title": t.title,
            "description": None,
            "amount_usd": None,  # KZT — currency stored separately.
            "currency": t.currency,
            "status": t.status,
            "published_at": t.published_at,
            "deadline_at": t.deadline_at,
            "raw": raw_payload,
        }

        # Detect insert vs update for accurate counters.
        existing_id = await session.scalar(
            select(Tender.id).where(
                Tender.source == SOURCE,
                Tender.external_id == t.external_id,
            )
        )

        stmt = pg_insert(Tender.__table__).values(**values)
        update_cols = {
            "customer_id": stmt.excluded.customer_id,
            "awarded_to_id": stmt.excluded.awarded_to_id,
            "title": stmt.excluded.title,
            "amount_usd": stmt.excluded.amount_usd,
            "currency": stmt.excluded.currency,
            "status": stmt.excluded.status,
            "published_at": stmt.excluded.published_at,
            "deadline_at": stmt.excluded.deadline_at,
            "raw": stmt.excluded.raw,
        }
        stmt = stmt.on_conflict_do_update(
            constraint="uq_tenders_source_external_id",
            set_=update_cols,
        )
        await session.execute(stmt)

        if existing_id is None:
            counters["inserted"] += 1
        else:
            counters["updated"] += 1

    await session.flush()
    return counters


async def _resolve_bins(
    session: AsyncSession, bins: set[str | None]
) -> dict[str, str]:
    """Return ``{bin: company_id}`` for BINs that map to an existing company."""

    clean = {b for b in bins if b}
    if not clean:
        return {}
    rows = await session.execute(
        select(Company.id, Company.bin).where(Company.bin.in_(clean))
    )
    return {row.bin: row.id for row in rows if row.bin}
