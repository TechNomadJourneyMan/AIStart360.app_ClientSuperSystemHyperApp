"""Param validation tests — POST with mismatched params returns 422.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC
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


@pytest.fixture(autouse=True)
def patch_create(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force `create` to do schema validation but never touch a DB.

    We want this test to specifically exercise the JSON-schema validator path.
    """

    async def _create(_session: Any, *, user_id: uuid.UUID, payload: Any) -> Any:
        widgets_svc.validate_params(payload.widget_type, payload.params)
        # If we got here, validation passed unexpectedly — return a fake row.
        from datetime import datetime

        class _Row:
            pass

        row = _Row()
        row.id = uuid.uuid4()  # type: ignore[attr-defined]
        row.user_id = user_id  # type: ignore[attr-defined]
        row.widget_type = payload.widget_type  # type: ignore[attr-defined]
        row.name = payload.name  # type: ignore[attr-defined]
        row.params = payload.params  # type: ignore[attr-defined]
        row.layout = None  # type: ignore[attr-defined]
        row.sort_index = payload.sort_index  # type: ignore[attr-defined]
        row.created_at = datetime.now(UTC)  # type: ignore[attr-defined]
        row.updated_at = datetime.now(UTC)  # type: ignore[attr-defined]
        return row

    monkeypatch.setattr(widgets_svc, "create", _create)


async def test_metric_with_unknown_metric_key_rejected() -> None:
    test_app = _build_app()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/widgets",
            json={
                "widget_type": "metric",
                "name": "Bad",
                "params": {
                    "metric_key": "not_a_real_metric",
                    "filter_ref": None,
                    "format": "integer",
                },
                "sort_index": 0,
            },
        )
    assert resp.status_code == 422
    body = resp.json()
    assert body["errors"][0]["code"] == "WIDGET_PARAMS_INVALID"


async def test_list_widget_with_chart_params_rejected() -> None:
    """A `list` widget cannot accept `chart` params (additionalProperties false)."""
    test_app = _build_app()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/widgets",
            json={
                "widget_type": "list",
                "name": "Bad",
                "params": {
                    "chart_kind": "bar",
                    "data_source": "companies",
                    "columns": ["name"],
                    "limit": 5,
                },
                "sort_index": 0,
            },
        )
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["code"] == "WIDGET_PARAMS_INVALID"


async def test_chart_with_out_of_range_top_n_rejected() -> None:
    test_app = _build_app()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/widgets",
            json={
                "widget_type": "chart",
                "name": "Too big",
                "params": {
                    "chart_kind": "bar",
                    "data_source": "industry_distribution",
                    "top_n": 999,
                    "filter_ref": None,
                },
                "sort_index": 0,
            },
        )
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["code"] == "WIDGET_PARAMS_INVALID"
