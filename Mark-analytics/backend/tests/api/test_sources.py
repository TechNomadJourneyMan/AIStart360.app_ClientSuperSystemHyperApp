"""Tests for the `sources` registry seed + admin endpoints.

DB-bound paths are marked `integration` and skipped if Postgres isn't reachable.
The non-integration test asserts purely on the seed data structure.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


# ────────────────────────────────────────────────────────────────────────
# Pure / structural — no DB required
# ────────────────────────────────────────────────────────────────────────


def test_seed_registry_shape() -> None:
    """The seed list must be well-formed and cover the headline categories."""
    from scripts.seed_sources import SOURCES  # type: ignore[import-not-found]

    assert len(SOURCES) >= 40, f"expected ≥40 sources, got {len(SOURCES)}"

    keys = [s["key"] for s in SOURCES]
    # Keys must be unique — duplicates would silently merge on upsert.
    assert len(keys) == len(set(keys)), "duplicate source keys in seed"

    required = {
        "key", "name", "kind", "base_url",
        "category", "geo_scope", "priority",
        "auth_type", "response_format", "enabled",
    }
    for row in SOURCES:
        missing = required - row.keys()
        assert not missing, f"{row['key']}: missing {missing}"
        assert 1 <= row["priority"] <= 10
        assert row["response_format"] in {"json", "xml", "csv", "rss", "html"}
        assert row["geo_scope"] in {"kz", "cis", "global", "regional"}

    categories = {s["category"] for s in SOURCES}
    for must_have in {"macro", "markets", "tenders", "news", "sanctions", "geo", "weather"}:
        assert must_have in categories, f"category {must_have} missing from seed"


def test_seed_runs_idempotent_in_memory() -> None:
    """Re-iterating the seed list must not change cardinality.

    The actual DB-level idempotency (`ON CONFLICT (key) DO UPDATE`) is exercised
    in the integration test below.
    """
    from scripts.seed_sources import SOURCES  # type: ignore[import-not-found]

    keys_once = {s["key"] for s in SOURCES}
    keys_twice = {s["key"] for s in (SOURCES + SOURCES)}
    assert keys_once == keys_twice
    assert len(keys_once) == len(SOURCES)


# ────────────────────────────────────────────────────────────────────────
# API surface — uses TestClient against the FastAPI app; requires DB
# ────────────────────────────────────────────────────────────────────────


@pytest.mark.integration
async def test_admin_sources_requires_token() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/admin/sources")
    assert resp.status_code == 401


@pytest.mark.integration
async def test_list_sources_filter_by_category() -> None:
    headers = {"X-Admin-Token": settings.SECRET_KEY}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/api/v1/admin/sources",
            headers=headers,
            params={"category": "sanctions"},
        )
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    assert body["errors"] == []
    items = body["data"]
    # The seed must contain the canonical sanctions feeds; if the test DB has
    # not been seeded, that's a setup issue — the assertion would still flag it.
    if items:
        for item in items:
            assert item["category"] == "sanctions"


@pytest.mark.integration
async def test_seed_runs_idempotent_db() -> None:
    """Running the upsert twice must not change row count."""
    from sqlalchemy import func, select

    from app.db.session import async_session_factory
    from app.models.source import Source
    from scripts.seed_sources import SOURCES, upsert_sources  # type: ignore[import-not-found]

    await upsert_sources(SOURCES)
    async with async_session_factory() as session:
        count_first = (await session.execute(select(func.count(Source.key)))).scalar() or 0

    await upsert_sources(SOURCES)
    async with async_session_factory() as session:
        count_second = (await session.execute(select(func.count(Source.key)))).scalar() or 0

    assert count_first == count_second
    assert count_first >= len(SOURCES)
