"""Admin endpoints for monitoring + triggering data ingestion.

Gated: requires `X-Admin-Token` header matching settings.SECRET_KEY (dev token)
OR a Supabase JWT with role=admin in claims. For local dev we use the token gate.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, func, select

from app.config import settings
from app.core.deps import SessionDep
from app.core.errors import envelope
from app.models.company import Company
from app.models.ingest_job import IngestJob

router = APIRouter()


def require_admin(x_admin_token: str | None = Header(default=None)) -> bool:
    """Simple dev gate. Replace with Supabase role check in prod."""
    if not x_admin_token or x_admin_token != settings.SECRET_KEY:
        raise HTTPException(status_code=401, detail="Admin token required")
    return True


@router.get("/ingest/stats", summary="DB ingest stats")
async def ingest_stats(
    session: SessionDep, _admin: bool = Depends(require_admin),
) -> dict[str, Any]:
    total = (await session.execute(select(func.count(Company.id)))).scalar() or 0
    kz_total = (await session.execute(
        select(func.count(Company.id)).where(Company.country == "KZ")
    )).scalar() or 0
    by_source = (await session.execute(
        select(
            func.coalesce(Company.data_source, "unknown"),
            func.count(Company.id),
        ).group_by(Company.data_source).order_by(func.count(Company.id).desc())
    )).all()
    by_size = (await session.execute(
        select(
            func.coalesce(Company.size_category, "unknown"),
            func.count(Company.id),
        ).where(Company.country == "KZ").group_by(Company.size_category)
    )).all()
    # Quality gaps
    missing_kato = (await session.execute(
        select(func.count(Company.id)).where(
            Company.country == "KZ",
            Company.bin.isnot(None),
            Company.kato_code.is_(None),
        )
    )).scalar() or 0
    missing_industry = (await session.execute(
        select(func.count(Company.id)).where(
            Company.country == "KZ",
            Company.industry_code.is_(None),
        )
    )).scalar() or 0
    return envelope(data={
        "total_companies": int(total),
        "kz_companies": int(kz_total),
        "by_source": [{"source": s, "count": int(c)} for s, c in by_source],
        "by_size_kz": [{"size": s, "count": int(c)} for s, c in by_size],
        "quality_gaps": {
            "missing_kato": int(missing_kato),
            "missing_industry": int(missing_industry),
        },
    })


@router.get("/ingest/jobs", summary="Recent ingest jobs")
async def list_jobs(
    session: SessionDep, _admin: bool = Depends(require_admin), limit: int = 25,
) -> dict[str, Any]:
    stmt = select(IngestJob).order_by(desc(IngestJob.started_at)).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return envelope(data=[
        {
            "id": str(j.id),
            "source": j.source,
            "kind": j.kind,
            "status": j.status,
            "started_at": j.started_at.isoformat(),
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            "duration_s": (j.finished_at - j.started_at).total_seconds()
                          if j.finished_at else None,
            "items_processed": j.items_processed,
            "items_added": j.items_added,
            "items_updated": j.items_updated,
            "items_failed": j.items_failed,
            "error": j.error,
        }
        for j in rows
    ])


@router.post("/ingest/run", summary="Trigger an enrichment run synchronously")
async def trigger_run(
    session: SessionDep, _admin: bool = Depends(require_admin),
    source: str = "kz_stat_gov", limit: int = 10, bin: str | None = None,
) -> dict[str, Any]:
    """Runs EnrichmentAgent inline (small batches only). For large — use Arq queue."""
    from app.agents.base import AgentJob
    from app.agents.enrichment import EnrichmentAgent

    if limit > 50:
        raise HTTPException(status_code=400, detail="limit ≤ 50 for inline runs; use Arq for larger")

    agent = EnrichmentAgent()
    job = AgentJob(id="admin-inline", idempotency_key=f"admin:{bin or limit}",
                   payload={"source": source, "limit": limit, "bin": bin})
    result = await agent.run(job)
    return envelope(data={
        "ok": result.ok,
        "output": result.output,
        "error": result.error,
    })


# ─── Firecrawl ──────────────────────────────────────────────────────


class FirecrawlScrapeReq(BaseModel):
    url: str


class FirecrawlBatchReq(BaseModel):
    count: int = 10
    search: str | None = None


@router.get("/firecrawl/status", summary="Firecrawl key + health probe")
async def firecrawl_status(_admin: bool = Depends(require_admin)) -> dict[str, Any]:
    from app.crawlers.firecrawl_client import firecrawl

    has_key = bool(settings.FIRECRAWL_API_KEY)
    health = False
    error: str | None = None
    if has_key:
        try:
            health = await firecrawl.healthcheck()
        except Exception as e:  # noqa: BLE001
            error = str(e)[:200]
    return envelope(data={
        "configured": has_key,
        "base_url": settings.FIRECRAWL_BASE_URL,
        "healthy": health,
        "error": error,
    })


@router.post("/firecrawl/scrape-url", summary="Scrape one URL + upsert company")
async def firecrawl_scrape_url(
    req: FirecrawlScrapeReq, _admin: bool = Depends(require_admin),
) -> dict[str, Any]:
    from app.agents.base import AgentJob
    from app.agents.firecrawl_enrichment import FirecrawlEnrichmentAgent

    agent = FirecrawlEnrichmentAgent()
    job = AgentJob(id="admin-firecrawl", idempotency_key=f"firecrawl:{req.url}",
                   payload={"mode": "url", "url": req.url, "source": _source_from_url(req.url)})
    result = await agent.run(job)
    return envelope(data={"ok": result.ok, "output": result.output, "error": result.error})


@router.post("/firecrawl/scrape-batch", summary="Discover + scrape N companies via Firecrawl")
async def firecrawl_scrape_batch(
    req: FirecrawlBatchReq, _admin: bool = Depends(require_admin),
) -> dict[str, Any]:
    from app.agents.base import AgentJob
    from app.agents.firecrawl_enrichment import FirecrawlEnrichmentAgent

    if req.count > 50:
        raise HTTPException(status_code=400, detail="count ≤ 50 for inline; use Arq for larger")

    agent = FirecrawlEnrichmentAgent()
    job = AgentJob(id="admin-firecrawl-batch", idempotency_key=f"firecrawl:batch:{req.count}",
                   payload={"mode": "batch", "count": req.count, "source": "kompra.kz"})
    result = await agent.run(job)
    return envelope(data={"ok": result.ok, "output": result.output, "error": result.error})


def _source_from_url(url: str) -> str:
    for s in ("kompra.kz", "adata.kz", "ranker.kz", "stat.gov.kz", "egov.kz", "goszakup.gov.kz"):
        if s in url:
            return s
    return "firecrawl"
