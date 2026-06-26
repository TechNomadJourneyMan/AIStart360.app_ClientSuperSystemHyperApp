"""Tests for self-service `/me` endpoints — profile, usage, limits, subscription.

All tests are unit tests: dependencies on Postgres (via `ensure_user_exists`),
Redis (via `current_usage`) and Supabase JWT are replaced with monkeypatching
plus `app.dependency_overrides`. We mount the `me` router on a freshly built
FastAPI app so the tests do not depend on `app/api/v1/__init__.py` wiring.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, AsyncIterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1 import me as me_module
from app.billing import quota
from app.billing.tier import Tier
from app.core.deps import get_current_user, get_session
from app.core.errors import (
    AppError,
    app_error_handler,
    http_handler,
    validation_handler,
)
from app.core.security import SupabaseUserClaims
from app.schemas.me import LimitsResponse, UsageResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException


_USER_ID = "11111111-1111-1111-1111-111111111111"


def _claims() -> SupabaseUserClaims:
    return SupabaseUserClaims(
        user_id=_USER_ID,
        email="alice@example.com",
        role="authenticated",
        app_metadata={"plan": "free", "role": "user"},
        user_metadata={},
        raw={},
    )


def _fake_db_user(plan: str = "free") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.UUID(_USER_ID),
        email="alice@example.com",
        plan=plan,
        role="user",
        org_id=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


async def _empty_session() -> AsyncIterator[None]:
    yield None


def _build_app() -> FastAPI:
    test_app = FastAPI()
    test_app.include_router(me_module.router, prefix="/api/v1/me", tags=["me"])
    # Mirror real app's error handling so responses use the envelope.
    test_app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    # The endpoints depend on a session even though our fakes ignore it.
    test_app.dependency_overrides[get_session] = _empty_session
    return test_app


@pytest.fixture
def patched(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {
        "tier": Tier.FREE,
        "usage": {"searches": 12, "profiles": 2, "forecasts": 0, "uploads": 1},
        "db_user": _fake_db_user(plan="free"),
    }

    async def _fake_ensure(_session: Any, _claims_in: SupabaseUserClaims) -> Any:
        return state["db_user"]

    async def _fake_get_tier(_claims_in: SupabaseUserClaims) -> Tier:
        return state["tier"]

    async def _fake_usage(_user_id: str) -> dict[str, int]:
        return dict(state["usage"])

    monkeypatch.setattr(me_module, "ensure_user_exists", _fake_ensure)
    monkeypatch.setattr(me_module, "get_user_tier", _fake_get_tier)
    monkeypatch.setattr(quota, "current_usage", _fake_usage)
    return state


async def _get(test_app: FastAPI, path: str, *, auth: bool = True) -> tuple[int, dict[str, Any]]:
    transport = ASGITransport(app=test_app)
    headers = {"Authorization": "Bearer test"} if auth else {}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(path, headers=headers)
    return resp.status_code, resp.json()


async def test_me_returns_profile(patched: dict[str, Any]) -> None:
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims

    status, body = await _get(test_app, "/api/v1/me")
    assert status == 200
    data = body["data"]
    assert data["id"] == _USER_ID
    assert data["email"] == "alice@example.com"
    assert data["plan"] == "free"
    assert data["role"] == "user"
    assert data["org_id"] is None
    assert "created_at" in data


async def test_usage_reflects_redis_counters(patched: dict[str, Any]) -> None:
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims

    status, body = await _get(test_app, "/api/v1/me/usage")
    assert status == 200
    payload = UsageResponse.model_validate(body["data"])
    assert payload.searches.used == 12
    assert payload.searches.limit == 50  # FREE tier cap
    assert payload.profiles.used == 2
    assert payload.forecasts.used == 0
    assert payload.uploads.used == 1
    # reset_at is always the first day of next UTC month
    assert payload.searches.reset_at.day == 1
    assert payload.searches.reset_at.tzinfo is not None
    assert body["meta"]["tier"] == "free"


async def test_limits_match_tier_table(patched: dict[str, Any]) -> None:
    patched["tier"] = Tier.PRO
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims

    status, body = await _get(test_app, "/api/v1/me/limits")
    assert status == 200
    limits = LimitsResponse.model_validate(body["data"])
    assert limits.plan == "pro"
    assert limits.searches_per_month == 10_000
    assert limits.alerts_max == 25
    assert limits.api_rpm == 1000


async def test_subscription_active_with_label(patched: dict[str, Any]) -> None:
    patched["tier"] = Tier.STARTER
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims

    status, body = await _get(test_app, "/api/v1/me/subscription")
    assert status == 200
    data = body["data"]
    assert data["plan"] == "starter"
    assert data["plan_label"] == "Starter"
    assert data["status"] == "active"
    assert data["current_period_end"] is None


async def test_me_requires_auth(patched: dict[str, Any]) -> None:
    """Without a bearer header the endpoint must reject with 401."""
    test_app = _build_app()
    # Do NOT override get_current_user — the real one will run and 401.
    status, body = await _get(test_app, "/api/v1/me", auth=False)
    assert status == 401
    assert body["errors"][0]["code"] in {"MISSING_TOKEN", "UNAUTHORIZED"}


def test_next_reset_at_rolls_over_december() -> None:
    """December must roll over to January of the next year."""
    dec = datetime(2026, 12, 15, 10, 0, tzinfo=timezone.utc)
    assert quota.next_reset_at(dec) == datetime(2027, 1, 1, tzinfo=timezone.utc)

    jun = datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc)
    assert quota.next_reset_at(jun) == datetime(2026, 7, 1, tzinfo=timezone.utc)


def test_limits_for_matches_quota_table() -> None:
    """`limits_for` is a thin projection of `TierQuota` — keep them in sync."""
    free = quota.limits_for(Tier.FREE)
    assert free == {"searches": 50, "profiles": 5, "forecasts": 0, "uploads": 1}
    business = quota.limits_for(Tier.BUSINESS)
    assert business["searches"] == 100_000
