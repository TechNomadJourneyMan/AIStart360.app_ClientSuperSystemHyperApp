"""Widget CRUD endpoint tests (unit, no DB).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.

The router is mounted on a fresh FastAPI app and the `widgets` service is
monkeypatched to use an in-process dict so we exercise the HTTP layer +
schema validation + ownership rules without spinning up Postgres.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
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
    NotFoundError,
    app_error_handler,
    http_handler,
    validation_handler,
)
from app.core.security import SupabaseUserClaims
from app.services import widgets as widgets_svc

_USER_A = "11111111-1111-1111-1111-111111111111"
_USER_B = "22222222-2222-2222-2222-222222222222"


def _claims(user_id: str) -> SupabaseUserClaims:
    return SupabaseUserClaims(
        user_id=user_id,
        email=f"{user_id}@test.example",
        role="authenticated",
        app_metadata={"plan": "free", "role": "user"},
        user_metadata={},
        raw={},
    )


async def _empty_session() -> AsyncIterator[None]:
    yield None


def _build_app() -> FastAPI:
    test_app = FastAPI()
    test_app.include_router(
        widgets_router_module.router, prefix="/api/v1/widgets", tags=["widgets"]
    )
    test_app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    test_app.dependency_overrides[get_session] = _empty_session
    return test_app


class _FakeWidget:
    """Duck-type the ORM model used by `WidgetRead.model_validate`."""

    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


@pytest.fixture
def fake_store(monkeypatch: pytest.MonkeyPatch) -> dict[uuid.UUID, _FakeWidget]:
    store: dict[uuid.UUID, _FakeWidget] = {}

    async def _list_for_user(_session: Any, *, user_id: uuid.UUID) -> list[_FakeWidget]:
        return [w for w in store.values() if w.user_id == user_id]

    async def _get_for_user(
        _session: Any, *, widget_id: uuid.UUID, user_id: uuid.UUID
    ) -> _FakeWidget:
        row = store.get(widget_id)
        if row is None or row.user_id != user_id:
            raise NotFoundError(
                f"Widget {widget_id} not found", code="WIDGET_NOT_FOUND"
            )
        return row

    async def _create(_session: Any, *, user_id: uuid.UUID, payload: Any) -> _FakeWidget:
        # Re-use real validator so schema misuse still 422s.
        widgets_svc.validate_params(payload.widget_type, payload.params)
        wid = uuid.uuid4()
        now = datetime.now(UTC)
        row = _FakeWidget(
            id=wid,
            user_id=user_id,
            widget_type=payload.widget_type,
            name=payload.name,
            params=payload.params,
            layout=payload.layout.model_dump() if payload.layout else None,
            sort_index=payload.sort_index,
            created_at=now,
            updated_at=now,
        )
        store[wid] = row
        return row

    async def _update(
        _session: Any,
        *,
        widget_id: uuid.UUID,
        user_id: uuid.UUID,
        payload: Any,
    ) -> _FakeWidget:
        row = await _get_for_user(_session, widget_id=widget_id, user_id=user_id)
        if payload.params is not None:
            widgets_svc.validate_params(row.widget_type, payload.params)
            row.params = payload.params
        if payload.name is not None:
            row.name = payload.name
        if payload.layout is not None:
            row.layout = payload.layout.model_dump()
        if payload.sort_index is not None:
            row.sort_index = payload.sort_index
        row.updated_at = datetime.now(UTC)
        return row

    async def _delete(
        _session: Any, *, widget_id: uuid.UUID, user_id: uuid.UUID
    ) -> None:
        row = await _get_for_user(_session, widget_id=widget_id, user_id=user_id)
        store.pop(row.id, None)

    monkeypatch.setattr(widgets_svc, "list_for_user", _list_for_user)
    monkeypatch.setattr(widgets_svc, "get_for_user", _get_for_user)
    monkeypatch.setattr(widgets_svc, "create", _create)
    monkeypatch.setattr(widgets_svc, "update", _update)
    monkeypatch.setattr(widgets_svc, "delete", _delete)
    return store


async def _client(test_app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test")


async def test_catalog_endpoint_is_public(fake_store: dict[uuid.UUID, _FakeWidget]) -> None:
    test_app = _build_app()
    async with await _client(test_app) as client:
        resp = await client.get("/api/v1/widgets/catalog")
    assert resp.status_code == 200
    body = resp.json()
    ids = {item["id"] for item in body["data"]}
    assert ids == {"metric", "list", "chart", "map_mini", "news", "note"}


async def test_create_list_get_update_delete_happy_path(
    fake_store: dict[uuid.UUID, _FakeWidget],
) -> None:
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = lambda: _claims(_USER_A)

    async with await _client(test_app) as client:
        # Create
        create_resp = await client.post(
            "/api/v1/widgets",
            json={
                "widget_type": "metric",
                "name": "Companies",
                "params": {
                    "metric_key": "total_companies",
                    "filter_ref": None,
                    "format": "integer",
                },
                "sort_index": 0,
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        widget_id = create_resp.json()["data"]["id"]

        # List
        list_resp = await client.get("/api/v1/widgets")
        assert list_resp.status_code == 200
        items = list_resp.json()["data"]
        assert len(items) == 1
        assert items[0]["id"] == widget_id

        # Update
        patch_resp = await client.patch(
            f"/api/v1/widgets/{widget_id}",
            json={"name": "Companies (renamed)"},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["data"]["name"] == "Companies (renamed)"

        # Delete
        del_resp = await client.delete(f"/api/v1/widgets/{widget_id}")
        assert del_resp.status_code == 204

        # Now empty
        list_resp_2 = await client.get("/api/v1/widgets")
        assert list_resp_2.json()["data"] == []


async def test_other_user_widget_returns_404(
    fake_store: dict[uuid.UUID, _FakeWidget],
) -> None:
    """Ownership check: user B cannot read user A's widget."""
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = lambda: _claims(_USER_A)

    async with await _client(test_app) as client:
        resp = await client.post(
            "/api/v1/widgets",
            json={
                "widget_type": "note",
                "name": "Private",
                "params": {"markdown": "shh"},
                "sort_index": 0,
            },
        )
        widget_id = resp.json()["data"]["id"]

    # Switch user
    test_app.dependency_overrides[get_current_user] = lambda: _claims(_USER_B)
    async with await _client(test_app) as client:
        get_resp = await client.patch(
            f"/api/v1/widgets/{widget_id}", json={"name": "stolen"}
        )
        assert get_resp.status_code == 404
        assert get_resp.json()["errors"][0]["code"] == "WIDGET_NOT_FOUND"

        del_resp = await client.delete(f"/api/v1/widgets/{widget_id}")
        assert del_resp.status_code == 404


async def test_list_requires_auth(fake_store: dict[uuid.UUID, _FakeWidget]) -> None:
    test_app = _build_app()
    async with await _client(test_app) as client:
        resp = await client.get("/api/v1/widgets")
    assert resp.status_code == 401
