"""AI-suggest endpoint tests with the AI Gateway mocked.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import widgets as widgets_router_module
from app.core.deps import get_current_user, get_session
from app.core.errors import (
    AppError,
    app_error_handler,
    http_handler,
    validation_handler,
)
from app.core.security import SupabaseUserClaims
from app.services import widgets as widgets_svc


async def _empty_session() -> AsyncIterator[None]:
    yield None


def _claims() -> SupabaseUserClaims:
    return SupabaseUserClaims(
        user_id="11111111-1111-1111-1111-111111111111",
        email="t@example.com",
        role="authenticated",
        app_metadata={"plan": "free", "role": "user"},
        user_metadata={},
        raw={},
    )


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(
        widgets_router_module.router, prefix="/api/v1/widgets", tags=["widgets"]
    )
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_session] = _empty_session
    app.dependency_overrides[get_current_user] = _claims
    return app


class _FakeGenResponse:
    """Just enough surface area to look like `GenerateResponse` to the caller."""

    def __init__(self, text: str) -> None:
        self.text = text


def _patch_quota_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(_session: Any, *, user_id: Any) -> None:
        return None

    monkeypatch.setattr(widgets_svc, "_bump_ai_quota", _noop)


@pytest.fixture
def patch_gateway(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace `app.ai.gateway.generate` for the service under test."""
    state: dict[str, Any] = {"response": _FakeGenResponse("")}

    async def _fake_generate(_req: Any) -> _FakeGenResponse:
        return state["response"]

    # Patch the imported binding inside the service module so we don't have
    # to mess with the real gateway singleton.
    from app.services import widgets as svc_mod

    monkeypatch.setattr(svc_mod.gateway, "generate", _fake_generate)
    _patch_quota_noop(monkeypatch)
    return state


async def test_ai_suggest_happy_path_returns_widget_config(
    patch_gateway: dict[str, Any],
) -> None:
    patch_gateway["response"] = _FakeGenResponse(
        json.dumps(
            {
                "metric_key": "active",
                "filter_ref": None,
                "format": "integer",
            }
        )
    )
    test_app = _build_app()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/widgets/ai-suggest",
            json={"prompt": "show me active companies count", "widget_type": "metric"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["widget_type"] == "metric"
    assert data["params"]["metric_key"] == "active"
    assert data["error"] is None


async def test_ai_suggest_invalid_json_returns_schema_validation_error(
    patch_gateway: dict[str, Any],
) -> None:
    patch_gateway["response"] = _FakeGenResponse("not json at all")
    test_app = _build_app()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/widgets/ai-suggest",
            json={"prompt": "anything", "widget_type": "metric"},
        )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["error"] == "schema_validation"
    assert "non-JSON" in (data["reason"] or "") or data["reason"]
    assert data["raw"] == "not json at all"


async def test_ai_suggest_json_failing_schema_returns_schema_validation_error(
    patch_gateway: dict[str, Any],
) -> None:
    # Valid JSON, but the metric_key is not in the allowed enum.
    patch_gateway["response"] = _FakeGenResponse(
        json.dumps({"metric_key": "bogus", "filter_ref": None, "format": "integer"})
    )
    test_app = _build_app()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/widgets/ai-suggest",
            json={"prompt": "anything", "widget_type": "metric"},
        )
    data = resp.json()["data"]
    assert data["error"] == "schema_validation"
    assert data["widget_type"] is None
    assert data["params"] is None
