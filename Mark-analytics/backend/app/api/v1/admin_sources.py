"""Admin endpoints for the `sources` registry.

Gated by the same dev-admin token used in `admin_ingest.py` (X-Admin-Token).
In production the gate should swap to a Supabase role check via
`require_min_tier(Tier.ADMIN)` once that helper lands.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.admin_ingest import require_admin
from app.core.deps import SessionDep
from app.core.errors import envelope
from app.schemas.source import (
    HealthCheckResult,
    SourceInfo,
    SourceListItem,
    SourceUpdate,
)
from app.services.sources import (
    get_source,
    list_sources,
    ping_source,
    record_health,
    update_source,
)

router = APIRouter()


@router.get("", summary="List registered data sources")
async def list_sources_endpoint(
    session: SessionDep,
    _admin: bool = Depends(require_admin),
    category: str | None = Query(default=None),
    geo_scope: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, Any]:
    rows = await list_sources(
        session, category=category, geo_scope=geo_scope, enabled=enabled, limit=limit,
    )
    items = [SourceListItem.model_validate(r).model_dump(mode="json") for r in rows]
    return envelope(data=items, meta={"count": len(items)})


@router.get("/{key}", summary="Source detail")
async def get_source_endpoint(
    key: str, session: SessionDep, _admin: bool = Depends(require_admin),
) -> dict[str, Any]:
    row = await get_source(session, key)
    return envelope(data=SourceInfo.model_validate(row).model_dump(mode="json"))


@router.patch("/{key}", summary="Update mutable source fields")
async def patch_source_endpoint(
    key: str, payload: SourceUpdate, session: SessionDep,
    _admin: bool = Depends(require_admin),
) -> dict[str, Any]:
    row = await update_source(
        session, key, patch=payload.model_dump(exclude_unset=True),
    )
    return envelope(data=SourceInfo.model_validate(row).model_dump(mode="json"))


@router.post("/health-check/{key}", summary="Synchronously ping one source")
async def health_check_one(
    key: str, session: SessionDep, _admin: bool = Depends(require_admin),
) -> dict[str, Any]:
    source = await get_source(session, key)
    result = await ping_source(source)
    await record_health(
        session, key, status=result["status"], checked_at=result["checked_at"],
    )
    return envelope(data=HealthCheckResult(**result).model_dump(mode="json"))


@router.post("/health-check-all", summary="Probe all enabled sources concurrently")
async def health_check_all(
    session: SessionDep, _admin: bool = Depends(require_admin),
    concurrency: int = Query(default=8, ge=1, le=32),
    only_enabled: bool = Query(default=True),
) -> dict[str, Any]:
    """Inline batch probe.

    For very large registries this should be moved to an Arq job; with ~60
    sources and a concurrency cap of 8 it finishes inside the API timeout.
    """
    sources = await list_sources(
        session, enabled=True if only_enabled else None, limit=500,
    )
    if not sources:
        return envelope(data=[], meta={"count": 0})

    sem = asyncio.Semaphore(concurrency)

    async def _probe(s: Any) -> dict[str, Any]:
        async with sem:
            return await ping_source(s)

    results = await asyncio.gather(*(_probe(s) for s in sources), return_exceptions=False)

    # Persist health statuses in one transaction
    now = datetime.now(timezone.utc)
    for r in results:
        await record_health(
            session, r["key"], status=r["status"], checked_at=r["checked_at"] or now,
        )

    summary: dict[str, int] = {"ok": 0, "degraded": 0, "down": 0}
    for r in results:
        summary[r["status"]] = summary.get(r["status"], 0) + 1

    return envelope(
        data=[HealthCheckResult(**r).model_dump(mode="json") for r in results],
        meta={"count": len(results), "summary": summary},
    )
