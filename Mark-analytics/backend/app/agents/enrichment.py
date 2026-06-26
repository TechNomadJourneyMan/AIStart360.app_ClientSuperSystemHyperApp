"""EnrichmentAgent — pulls extra detail for known companies from public sources.

Strategy (KZ-first):
  1. If `bin` is present → query stat.gov.kz iAccessdata API.
  2. Merge non-conflicting fields into existing company row.
  3. Track via IngestJob.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentJob, AgentResult, BaseAgent
from app.crawlers.spiders.kz_stat_gov import KzStatGovSpider
from app.db.session import async_session_factory
from app.models.company import Company
from app.models.ingest_job import IngestJob


# Fields we are allowed to overwrite when source confidence is higher.
SAFE_FIELDS = (
    "industry_code", "industry_label", "legal_form", "status", "registered_at",
    "kato_code", "krp_code", "size_category", "ownership_type_detail",
    "oked_secondary",
)


class EnrichmentAgent(BaseAgent):
    name = "enrichment"
    task_topic = "events:enrichment"

    async def handle(self, job: AgentJob) -> AgentResult:
        """Job payload: { source: 'kz_stat_gov', limit: int, bin?: str | None }.

        If `bin` provided — enrich single company.
        Else — enrich up to `limit` companies missing kato_code or krp_code.
        """
        source = job.payload.get("source", "kz_stat_gov")
        limit = int(job.payload.get("limit", 25))
        single_bin = job.payload.get("bin")

        ingest_id: UUID | None = None
        async with async_session_factory() as session:
            j = IngestJob(source=source, kind="enrich", status="running")
            session.add(j)
            await session.commit()
            await session.refresh(j)
            ingest_id = j.id

            try:
                if single_bin:
                    bins = [single_bin]
                else:
                    bins = await _select_targets(session, limit)

                processed = added = updated = failed = 0
                spider = KzStatGovSpider()

                async with httpx.AsyncClient() as client:
                    for bin_code in bins:
                        processed += 1
                        try:
                            row = await spider.fetch_by_bin(client, bin_code)
                            if not row:
                                failed += 1
                                continue
                            result = await _upsert_company(session, row)
                            if result == "added":
                                added += 1
                            elif result == "updated":
                                updated += 1
                        except Exception as e:  # noqa: BLE001
                            self.log.warning("enrich_failed",
                                              bin=bin_code, error=str(e))
                            failed += 1

                await session.commit()

                # Mark job complete
                await session.execute(
                    update(IngestJob).where(IngestJob.id == ingest_id).values(
                        status="ok" if failed == 0 else ("partial" if added + updated > 0 else "failed"),
                        finished_at=datetime.now(timezone.utc),
                        items_processed=processed,
                        items_added=added,
                        items_updated=updated,
                        items_failed=failed,
                    )
                )
                await session.commit()

                return AgentResult(
                    ok=True,
                    output={
                        "ingest_job_id": str(ingest_id),
                        "processed": processed,
                        "added": added,
                        "updated": updated,
                        "failed": failed,
                    },
                )

            except Exception as e:  # noqa: BLE001
                await session.execute(
                    update(IngestJob).where(IngestJob.id == ingest_id).values(
                        status="failed",
                        finished_at=datetime.now(timezone.utc),
                        error=str(e)[:1000],
                    )
                )
                await session.commit()
                self.log.exception("enrichment_run_failed")
                return AgentResult(ok=False, error=str(e))


async def _select_targets(session: AsyncSession, limit: int) -> list[str]:
    """Pick companies that have a BIN but missing stat.gov.kz enrichment fields."""
    stmt = (
        select(Company.bin)
        .where(
            Company.country == "KZ",
            Company.bin.isnot(None),
            (Company.kato_code.is_(None)) | (Company.krp_code.is_(None)),
        )
        .order_by(Company.updated_at.asc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [b for b in rows if b]


async def _upsert_company(session: AsyncSession, row: dict[str, Any]) -> str:
    """Upsert by BIN. Returns 'added' | 'updated' | 'skipped'."""
    bin_code = row.get("bin")
    if not bin_code:
        return "skipped"
    existing = (await session.execute(
        select(Company).where(Company.bin == bin_code)
    )).scalar_one_or_none()

    if existing is None:
        c = Company(
            bin=bin_code,
            name=row["name"],
            name_normalized=row.get("name_normalized") or row["name"].lower(),
            country=row.get("country", "KZ"),
            industry_code=row.get("industry_code"),
            industry_label=row.get("industry_label"),
            oked_secondary=row.get("oked_secondary"),
            legal_form=row.get("legal_form"),
            status=row.get("status", "active"),
            kato_code=row.get("kato_code"),
            krp_code=row.get("krp_code"),
            size_category=row.get("size_category"),
            ownership_type_detail=row.get("ownership_type_detail"),
            raw=row.get("raw"),
            data_source=row.get("data_source", "stat.gov.kz"),
            source_confidence=row.get("source_confidence", 0.95),
            last_seen_at=datetime.now(timezone.utc),
        )
        session.add(c)
        return "added"

    # Update only safe fields when ours are NULL (don't overwrite curated values)
    changed = False
    for field in SAFE_FIELDS:
        new_val = row.get(field)
        if new_val is None:
            continue
        old_val = getattr(existing, field, None)
        if old_val is None:
            setattr(existing, field, new_val)
            changed = True
    existing.last_seen_at = datetime.now(timezone.utc)
    return "updated" if changed else "skipped"
