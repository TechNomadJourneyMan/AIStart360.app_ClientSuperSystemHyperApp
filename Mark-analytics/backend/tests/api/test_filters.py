"""Tests for filter taxonomy + region/city distribution endpoints.

The DB-backed parts are marked `integration` and skipped when a real
Postgres isn't reachable. Unit-level checks (registry shape, SQL building)
run without a DB by overriding the session dependency.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.billing.tier import Tier
from app.core.deps import get_current_user, get_session
from app.core.security import SupabaseUserClaims
from app.filters.registry import FILTERS, parse_filters
from app.main import app


# ────────────────────────────────────────────────────────────────────
# Registry: region/city now point to denormalized companies columns
# ────────────────────────────────────────────────────────────────────


def test_registry_region_city_backed_by_companies() -> None:
    assert FILTERS["region"].backed_by == "companies.region_name"
    assert FILTERS["city"].backed_by == "companies.city_name"
    assert FILTERS["region_kato"].backed_by == "companies.region_kato"
    # Aliases must exist for convenience
    assert "region_name" in FILTERS
    assert "city_name" in FILTERS


def test_parse_filters_accepts_region_name() -> None:
    parsed = parse_filters({"region_name": "Almaty"})
    assert "region_name" in parsed
    # MULTI_TEXT splits commas; single string becomes list
    assert parsed["region_name"] == ["Almaty"]


def test_parse_filters_accepts_region_kato_multi() -> None:
    parsed = parse_filters({"region_kato": "751,750"})
    assert parsed["region_kato"] == ["751", "750"]


def test_parse_filters_rejects_unknown_key() -> None:
    from app.core.errors import ValidationError

    with pytest.raises(ValidationError):
        parse_filters({"nonexistent": "x"})


# ────────────────────────────────────────────────────────────────────
# Service-level: WHERE clause is actually built for region_name filter
# ────────────────────────────────────────────────────────────────────


def test_build_clause_resolves_region_name() -> None:
    """_apply_filters must produce a WHERE that references companies.region_name."""
    from sqlalchemy import select

    from app.models.company import Company
    from app.services.analytics import _apply_filters

    stmt = select(Company)
    stmt = _apply_filters(stmt, {"region_name": ["Almaty"]})
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "region_name" in sql, f"region_name filter not applied; SQL: {sql}"
    assert "Almaty" in sql


def test_build_clause_does_not_touch_unrelated_filters() -> None:
    from sqlalchemy import select

    from app.models.company import Company
    from app.services.analytics import _apply_filters

    stmt = select(Company)
    stmt = _apply_filters(stmt, {"country": ["KZ"], "status": "active"})
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "country" in sql
    assert "status" in sql
    assert "KZ" in sql


# ────────────────────────────────────────────────────────────────────
# Endpoint smoke: /analytics/region-distribution returns envelope shape
# ────────────────────────────────────────────────────────────────────


class _FakeRow:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


@pytest.fixture()
def fake_session_with_geo_rows(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Any]:
    """Override get_session + auth so STARTER-gated endpoints respond 200."""
    session = MagicMock()

    async def _execute(_stmt: Any) -> Any:
        result = MagicMock()
        result.all.return_value = [
            _FakeRow(region_kato="751", region_name="Almaty", value=42),
            _FakeRow(region_kato="710", region_name="Astana", value=18),
        ]
        result.scalar.return_value = 0
        result.scalars.return_value.all.return_value = []
        return result

    session.execute = AsyncMock(side_effect=_execute)

    async def _override() -> AsyncIterator[Any]:
        yield session

    # Bypass STARTER tier gate by injecting a fake authenticated user
    # and patching the tier resolver inside the analytics router.
    fake_claims = SupabaseUserClaims(
        user_id="00000000-0000-0000-0000-000000000001",
        email="test@example.com",
        role="authenticated",
        app_metadata={"plan": "starter"},
        user_metadata={},
        raw={},
    )

    async def _fake_tier(_claims: Any) -> Tier:
        return Tier.STARTER

    monkeypatch.setattr("app.api.v1.analytics.get_user_tier", _fake_tier)
    app.dependency_overrides[get_session] = _override
    app.dependency_overrides[get_current_user] = lambda: fake_claims
    yield session
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_region_distribution_returns_data(
    fake_session_with_geo_rows: Any,
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/analytics/region-distribution?country=KZ")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "data" in body and "meta" in body and "errors" in body
    assert body["errors"] == []
    assert isinstance(body["data"], list)
    assert len(body["data"]) == 2
    first = body["data"][0]
    assert first["region_kato"] == "751"
    assert first["region_name"] == "Almaty"
    assert first["value"] == 42.0
    assert 0 <= first["percent_of_total"] <= 100
    assert body["meta"]["country"] == "KZ"
    assert body["meta"]["metric"] == "count"


@pytest.mark.asyncio
async def test_region_distribution_rejects_unknown_filter(
    fake_session_with_geo_rows: Any,
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/api/v1/analytics/region-distribution?country=KZ&bogus=1",
        )
    # parse_filters raises ValidationError → 422
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_region_filter_applied(
    fake_session_with_geo_rows: Any,
) -> None:
    """?region_name=Almaty must reach the service and build a WHERE clause.

    We inspect the SQL passed to session.execute.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/api/v1/analytics/region-distribution?country=KZ&region_name=Almaty",
        )
    assert resp.status_code == 200, resp.text

    session = fake_session_with_geo_rows
    assert session.execute.await_count >= 1
    rendered = []
    for call in session.execute.await_args_list:
        stmt = call.args[0]
        try:
            rendered.append(str(stmt.compile(compile_kwargs={"literal_binds": True})))
        except Exception:
            rendered.append(str(stmt))
    joined = "\n".join(rendered)
    assert "region_name" in joined
    assert "Almaty" in joined
