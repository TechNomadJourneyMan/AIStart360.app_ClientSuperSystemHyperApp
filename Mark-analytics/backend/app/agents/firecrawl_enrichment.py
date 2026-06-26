"""FirecrawlEnrichmentAgent — pulls company detail from kompra.kz / adata.kz / arbitrary URLs.

Two run modes:
  1. `mode="url"`  + `url` in payload — scrape a specific URL, upsert.
  2. `mode="batch"` + `count` in payload — discover N companies on kompra.kz, upsert all.

Records an IngestJob row for the admin dashboard either way.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentJob, AgentResult, BaseAgent
from app.agents.enrichment import SAFE_FIELDS, _upsert_company
from app.crawlers.firecrawl_client import FirecrawlNotConfigured, extract_company_from_url
from app.crawlers.spiders.kz_kompra_firecrawl import KzKompraFirecrawlSpider
from app.db.session import async_session_factory
from app.models.ingest_job import IngestJob


class FirecrawlEnrichmentAgent(BaseAgent):
    name = "firecrawl_enrichment"
    task_topic = "events:firecrawl_enrichment"

    async def handle(self, job: AgentJob) -> AgentResult:
        mode = job.payload.get("mode", "url")
        source = job.payload.get("source", "kompra.kz")

        async with async_session_factory() as session:
            ingest = IngestJob(source=source, kind="enrich", status="running")
            session.add(ingest)
            await session.commit()
            await session.refresh(ingest)
            ingest_id = ingest.id

            try:
                if mode == "url":
                    url = job.payload.get("url")
                    if not url:
                        raise ValueError("'url' required for mode=url")
                    summary = await self._run_single(session, url)
                else:  # batch
                    count = int(job.payload.get("count", 10))
                    summary = await self._run_batch(session, count)

                await session.execute(
                    update(IngestJob).where(IngestJob.id == ingest_id).values(
                        status=summary["status"],
                        finished_at=datetime.now(timezone.utc),
                        items_processed=summary["processed"],
                        items_added=summary["added"],
                        items_updated=summary["updated"],
                        items_failed=summary["failed"],
                        payload=summary.get("details"),
                    )
                )
                await session.commit()
                return AgentResult(ok=True, output={"ingest_job_id": str(ingest_id), **summary})

            except FirecrawlNotConfigured as e:
                await self._mark_failed(session, ingest_id, str(e))
                return AgentResult(ok=False, error=str(e))
            except Exception as e:  # noqa: BLE001
                await self._mark_failed(session, ingest_id, str(e))
                self.log.exception("firecrawl_enrich_failed")
                return AgentResult(ok=False, error=str(e))

    async def _run_single(self, session: AsyncSession, url: str) -> dict[str, Any]:
        row = await extract_company_from_url(url)
        if not row:
            return {"status": "failed", "processed": 1, "added": 0, "updated": 0,
                     "failed": 1, "details": {"url": url, "reason": "no data from Firecrawl"}}
        row = _clean_extracted(row)
        if not row.get("name"):
            return {"status": "failed", "processed": 1, "added": 0, "updated": 0,
                     "failed": 1, "details": {"url": url, "reason": "no company name in extraction"}}
        row.setdefault("country", "KZ")
        row.setdefault("data_source", _source_from_url(url))
        row.setdefault("source_confidence", 0.85)
        row["name_normalized"] = row["name"].lower().strip()
        result = await _upsert_company(session, row)
        await session.commit()
        return {
            "status": "ok" if result != "skipped" else "partial",
            "processed": 1,
            "added": 1 if result == "added" else 0,
            "updated": 1 if result == "updated" else 0,
            "failed": 0,
            "details": {"url": url, "result": result, "bin": row.get("bin"),
                         "name": row.get("name"), "industry_code": row.get("industry_code")},
        }

    async def _run_batch(self, session: AsyncSession, count: int) -> dict[str, Any]:
        spider = KzKompraFirecrawlSpider()
        processed = added = updated = skipped = failed = 0
        async for raw in spider.crawl(limit=count):
            processed += 1
            try:
                row = _clean_extracted(raw)
                if not row.get("name"):
                    failed += 1
                    continue
                row.setdefault("country", "KZ")
                row.setdefault("data_source", "kompra.kz")
                row.setdefault("source_confidence", 0.85)
                row["name_normalized"] = row["name"].lower().strip()
                result = await _upsert_company(session, row)
                if result == "added": added += 1
                elif result == "updated": updated += 1
                else: skipped += 1
            except Exception as e:  # noqa: BLE001
                self.log.warning("upsert_failed", err=str(e))
                failed += 1
        await session.commit()
        status = ("ok" if failed == 0 and (added + updated) > 0
                  else ("partial" if added + updated > 0 else "failed"))
        return {
            "status": status, "processed": processed, "added": added,
            "updated": updated, "failed": failed,
            "details": {"skipped": skipped},
        }


def _clean_extracted(row: dict[str, Any]) -> dict[str, Any]:
    """Firecrawl/LLM returns '' or [] for missing fields — normalize to omitted."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if v in ("", [], {}, None):
            continue
        out[k] = v
    # ОКЭД формат: '52291' → '52.29' (LLM иногда теряет точку)
    code = out.get("industry_code")
    if isinstance(code, str) and "." not in code and code.isdigit() and len(code) >= 4:
        out["industry_code"] = f"{code[:2]}.{code[2:4]}"
    # Year-only date → ISO
    if isinstance(out.get("registered_at"), str) and len(out["registered_at"]) == 4:
        out["registered_at"] = f"{out['registered_at']}-01-01"
    return out


def _source_from_url(url: str) -> str:
    for s in ("kompra.kz", "adata.kz", "ranker.kz", "stat.gov.kz", "egov.kz"):
        if s in url:
            return s
    return "firecrawl"

    async def _mark_failed(self, session: AsyncSession, ingest_id: UUID, error: str) -> None:
        await session.execute(
            update(IngestJob).where(IngestJob.id == ingest_id).values(
                status="failed", finished_at=datetime.now(timezone.utc),
                error=error[:1000],
            )
        )
        await session.commit()
