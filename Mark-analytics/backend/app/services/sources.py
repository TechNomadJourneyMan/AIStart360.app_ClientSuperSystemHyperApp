"""Service layer for the `sources` registry.

Pure async functions. Routers should call these and never speak SQL directly.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.source import Source


# ────────────────────────────────────────────────────────────────────────
# Read paths
# ────────────────────────────────────────────────────────────────────────


async def list_sources(
    session: AsyncSession,
    *,
    category: str | None = None,
    geo_scope: str | None = None,
    enabled: bool | None = None,
    limit: int = 200,
) -> list[Source]:
    stmt = select(Source)
    if category is not None:
        stmt = stmt.where(Source.category == category)
    if geo_scope is not None:
        stmt = stmt.where(Source.geo_scope == geo_scope)
    if enabled is not None:
        stmt = stmt.where(Source.enabled.is_(enabled))
    stmt = stmt.order_by(Source.priority.asc(), Source.key.asc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return list(rows)


async def get_source(session: AsyncSession, key: str) -> Source:
    row = await session.get(Source, key)
    if row is None:
        raise NotFoundError(f"Source not found: {key}", code="SOURCE_NOT_FOUND")
    return row


# ────────────────────────────────────────────────────────────────────────
# Mutations
# ────────────────────────────────────────────────────────────────────────


async def update_source(
    session: AsyncSession, key: str, *, patch: dict[str, Any],
) -> Source:
    # Filter out None values — they mean "leave unchanged" in PATCH semantics.
    fields = {k: v for k, v in patch.items() if v is not None}
    if not fields:
        return await get_source(session, key)

    res = await session.execute(
        update(Source).where(Source.key == key).values(**fields).returning(Source)
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise NotFoundError(f"Source not found: {key}", code="SOURCE_NOT_FOUND")
    await session.commit()
    return row


async def record_health(
    session: AsyncSession, key: str, *, status: str, checked_at: datetime,
) -> None:
    await session.execute(
        update(Source)
        .where(Source.key == key)
        .values(health_status=status, last_health_check=checked_at)
    )
    await session.commit()


# ────────────────────────────────────────────────────────────────────────
# Health check (HTTP ping)
# ────────────────────────────────────────────────────────────────────────


async def ping_source(source: Source, *, timeout_s: float = 10.0) -> dict[str, Any]:
    """HEAD-then-GET probe. Treats 2xx/3xx as ok, 4xx as degraded, 5xx/network as down."""
    started = time.perf_counter()
    http_status: int | None = None
    error: str | None = None
    status: str = "down"
    checked_at = datetime.now(timezone.utc)

    async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=True) as client:
        try:
            resp = await client.head(source.base_url)
            # Some servers reject HEAD — retry with GET.
            if resp.status_code in {405, 501}:
                resp = await client.get(source.base_url)
            http_status = resp.status_code
            if 200 <= resp.status_code < 400:
                status = "ok"
            elif 400 <= resp.status_code < 500:
                # 401/403 from registration-required APIs is "degraded but live"
                status = "degraded"
            else:
                status = "down"
        except httpx.TimeoutException:
            error = f"timeout after {timeout_s}s"
            status = "down"
        except httpx.HTTPError as e:
            error = str(e)[:300]
            status = "down"

    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "key": source.key,
        "base_url": source.base_url,
        "status": status,
        "http_status": http_status,
        "latency_ms": latency_ms,
        "checked_at": checked_at,
        "error": error,
    }
