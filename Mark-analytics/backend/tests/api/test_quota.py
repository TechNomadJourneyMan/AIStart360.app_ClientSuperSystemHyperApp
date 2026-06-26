"""Quota + tier enforcement tests.

These tests stub the Supabase JWT verifier and the Redis-backed quota counter
so they run without a live Postgres/Redis instance. DB-touching paths
(/companies list/detail) are exercised at the dependency level via
`app.dependency_overrides`.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.billing.tier import Tier
from app.core.deps import get_current_user, get_optional_user, get_session
from app.core.errors import QuotaExceededError, TierRequiredError
from app.core.security import SupabaseUserClaims
from app.main import app


# ────────────────────────────────────────────────────────────────────
# Helpers / fixtures
# ────────────────────────────────────────────────────────────────────


def _claims(plan: str = "free") -> SupabaseUserClaims:
    return SupabaseUserClaims(
        user_id=str(uuid4()),
        email="t@example.com",
        role="authenticated",
        app_metadata={"plan": plan},
        user_metadata={},
        raw={},
    )


class _FakeSession:
    """No-op AsyncSession stand-in. Service functions are monkey-patched away."""

    async def execute(self, *_a: Any, **_k: Any) -> Any:  # pragma: no cover
        return None

    async def commit(self) -> None:  # pragma: no cover
        return None

    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *_a: Any) -> None:
        return None


async def _fake_session_dep() -> Any:
    yield _FakeSession()


@pytest.fixture
def client_factory(monkeypatch: pytest.MonkeyPatch):
    """Return a builder so each test can pick the auth/quota mock it wants."""

    async def _list_companies_stub(
        _session: Any, *, filters: Any, q: Any, limit: int, cursor: Any
    ) -> tuple[list[Any], None, int]:
        return [], None, 0

    async def _get_company_by_id_stub(_session: Any, _company_id: Any) -> None:
        return None

    monkeypatch.setattr(
        "app.api.v1.companies.list_companies", _list_companies_stub,
    )
    monkeypatch.setattr(
        "app.api.v1.companies.get_company_by_id", _get_company_by_id_stub,
    )

    def _build(*, claims: SupabaseUserClaims | None) -> AsyncClient:
        app.dependency_overrides[get_session] = _fake_session_dep
        if claims is None:
            app.dependency_overrides[get_optional_user] = lambda: None
        else:
            app.dependency_overrides[get_optional_user] = lambda: claims
            app.dependency_overrides[get_current_user] = lambda: claims
        transport = ASGITransport(app=app)
        return AsyncClient(transport=transport, base_url="http://test")

    yield _build
    app.dependency_overrides.clear()


# ────────────────────────────────────────────────────────────────────
# A. /companies — quota enforcement
# ────────────────────────────────────────────────────────────────────


async def test_free_user_searches_limit(
    monkeypatch: pytest.MonkeyPatch, client_factory: Any,
) -> None:
    """After 50 searches, FREE tier gets 429 QUOTA_EXCEEDED with reset_at meta."""
    state = {"calls": 0}
    cap = 50

    async def fake_check(user_id: str, tier: Tier, quota: str, *, amount: int = 1) -> int:
        state["calls"] += 1
        if state["calls"] > cap:
            raise QuotaExceededError(
                f"Monthly quota for {quota} ({cap}) exceeded",
                kind=quota, used=cap, limit=cap,
                reset_at="2026-06-01T00:00:00+00:00",
                tier=tier.value,
            )
        return state["calls"]

    async def fake_tier(_claims: Any) -> Tier:
        return Tier.FREE

    monkeypatch.setattr("app.api.v1.companies.check_and_increment", fake_check)
    monkeypatch.setattr("app.api.v1.companies.get_user_tier", fake_tier)

    claims = _claims("free")
    async with client_factory(claims=claims) as client:
        # 50 OK
        for _ in range(cap):
            r = await client.get("/api/v1/companies")
            assert r.status_code == 200

        # 51st should fail with 429 / QUOTA_EXCEEDED
        r = await client.get("/api/v1/companies")
        assert r.status_code == 429
        body = r.json()
        assert body["errors"][0]["code"] == "QUOTA_EXCEEDED"
        assert body["errors"][0]["kind"] == "searches"
        assert body["errors"][0]["limit"] == cap
        assert body["errors"][0]["reset_at"].startswith("2026-")


async def test_starter_user_unlimited_search(
    monkeypatch: pytest.MonkeyPatch, client_factory: Any,
) -> None:
    """STARTER tier (1000/month) — repeated calls don't trip the limiter we mock."""
    counter = {"n": 0}

    async def fake_check(user_id: str, tier: Tier, quota: str, *, amount: int = 1) -> int:
        counter["n"] += 1
        return counter["n"]

    async def fake_tier(_claims: Any) -> Tier:
        return Tier.STARTER

    monkeypatch.setattr("app.api.v1.companies.check_and_increment", fake_check)
    monkeypatch.setattr("app.api.v1.companies.get_user_tier", fake_tier)

    claims = _claims("starter")
    async with client_factory(claims=claims) as client:
        for _ in range(60):
            r = await client.get("/api/v1/companies")
            assert r.status_code == 200
    assert counter["n"] == 60


async def test_anonymous_user_not_metered(
    monkeypatch: pytest.MonkeyPatch, client_factory: Any,
) -> None:
    """Anonymous browsers shouldn't touch the quota counter."""
    called = {"n": 0}

    async def fake_check(*_a: Any, **_k: Any) -> int:
        called["n"] += 1
        return 1

    monkeypatch.setattr("app.api.v1.companies.check_and_increment", fake_check)

    async with client_factory(claims=None) as client:
        r = await client.get("/api/v1/companies")
        assert r.status_code == 200
    assert called["n"] == 0


# ────────────────────────────────────────────────────────────────────
# B. /forecasts — tier gate
# ────────────────────────────────────────────────────────────────────


async def test_free_user_cannot_forecast(
    monkeypatch: pytest.MonkeyPatch, client_factory: Any,
) -> None:
    """POST /forecasts/{type} returns 402 TIER_REQUIRED on FREE tier."""
    async def fake_tier(_claims: Any) -> Tier:
        return Tier.FREE

    monkeypatch.setattr("app.api.v1.forecasts.get_user_tier", fake_tier)

    # Make sure no real forecast lookup runs before the tier check trips.
    def fake_get_forecast(_slug: str) -> Any:
        class _F:
            type = "kz_company_3y_revenue"
            title = "x"
            description = ""

            def validate_inputs(self, x: Any) -> Any:
                return x

            async def compute(self, *_a: Any, **_k: Any) -> Any:  # pragma: no cover
                raise AssertionError("should not run for FREE tier")

            def chart_shape(self, *_a: Any) -> dict[str, Any]:  # pragma: no cover
                return {}

        return _F()

    monkeypatch.setattr("app.api.v1.forecasts.get_forecast", fake_get_forecast)

    claims = _claims("free")
    async with client_factory(claims=claims) as client:
        r = await client.post(
            "/api/v1/forecasts/kz_company_3y_revenue",
            json={"company_id": "x"},
        )
    assert r.status_code == 402
    body = r.json()
    assert body["errors"][0]["code"] == "TIER_REQUIRED"
    assert body["errors"][0]["tier_required"] == "starter"
    assert body["errors"][0]["tier_current"] == "free"
    assert body["errors"][0]["upgrade_url"] == "/pricing"


# ────────────────────────────────────────────────────────────────────
# C. Pure-error tests (no HTTP)
# ────────────────────────────────────────────────────────────────────


def test_quota_exceeded_error_envelope_shape() -> None:
    err = QuotaExceededError(
        "nope", kind="searches", used=50, limit=50,
        reset_at="2026-06-01T00:00:00+00:00", tier="free",
    )
    assert err.status_code == 429
    assert err.code == "QUOTA_EXCEEDED"
    assert err.details["kind"] == "searches"
    assert err.details["limit"] == 50
    assert err.details["reset_at"].startswith("2026-")
    assert err.details["upgrade_url"] == "/pricing"


def test_tier_required_error_envelope_shape() -> None:
    err = TierRequiredError(
        "upgrade pls", tier_required="starter", tier_current="free",
    )
    assert err.status_code == 402
    assert err.code == "TIER_REQUIRED"
    assert err.details["tier_required"] == "starter"
    assert err.details["tier_current"] == "free"
    assert err.details["upgrade_url"] == "/pricing"
