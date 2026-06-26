"""Tests for `/api/v1/lists` (Track F — Saved Companies lists).

Unit tests: every service call into Postgres is replaced via `monkeypatch`. The
router itself is exercised through ASGI with `dependency_overrides`. A real DB
is not required.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import saved_lists as lists_module
from app.core.deps import get_current_user, get_session
from app.core.errors import (
    AppError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
    app_error_handler,
    http_handler,
    validation_handler,
)
from app.core.security import SupabaseUserClaims

_USER_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_ID = "22222222-2222-2222-2222-222222222222"


def _claims(user_id: str = _USER_ID) -> SupabaseUserClaims:
    return SupabaseUserClaims(
        user_id=user_id,
        email="alice@example.com",
        role="authenticated",
        app_metadata={"plan": "free", "role": "user"},
        user_metadata={},
        raw={},
    )


async def _empty_session() -> AsyncIterator[None]:
    yield None


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(lists_module.router, prefix="/api/v1/lists", tags=["lists"])
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_session] = _empty_session
    app.dependency_overrides[get_current_user] = _claims
    return app


def _fake_list(
    list_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str = "Hot leads",
    items: list[SimpleNamespace] | None = None,
) -> SimpleNamespace:
    now = datetime(2026, 5, 28, tzinfo=UTC)
    return SimpleNamespace(
        id=list_id,
        user_id=user_id,
        name=name,
        created_at=now,
        updated_at=now,
        items=items or [],
        __dict__={},
    )


def _fake_item(
    company_id: uuid.UUID,
    *,
    name: str = "Acme LLP",
    note: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        company_id=company_id,
        added_at=datetime(2026, 5, 28, tzinfo=UTC),
        note=note,
        company=SimpleNamespace(
            name=name,
            country="KZ",
            industry_code="62.01",
            industry_label="Software",
        ),
    )


async def _request(
    test_app: FastAPI,
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any] | str]:
    transport = ASGITransport(app=test_app)
    headers = {"Authorization": "Bearer test"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.request(method, path, headers=headers, json=json)
    try:
        return resp.status_code, resp.json()
    except ValueError:
        return resp.status_code, resp.text


# ─── happy paths ───────────────────────────────────────────────────────────────


async def test_create_list_returns_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()

    async def _fake_create(_session: Any, *, user_id: uuid.UUID, name: str) -> Any:
        assert user_id == uuid.UUID(_USER_ID)
        assert name == "Hot leads"
        return _fake_list(list_id, user_id, name=name)

    monkeypatch.setattr(lists_module, "create_list", _fake_create)
    app = _build_app()

    status, body = await _request(app, "POST", "/api/v1/lists", json={"name": "Hot leads"})
    assert status == 201
    assert isinstance(body, dict)
    assert body["data"]["id"] == str(list_id)
    assert body["data"]["name"] == "Hot leads"
    assert body["data"]["item_count"] == 0


async def test_index_returns_lists_with_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()

    async def _fake_index(_session: Any, *, user_id: uuid.UUID) -> Any:
        return [(_fake_list(list_id, user_id, name="A"), 3)]

    monkeypatch.setattr(lists_module, "list_for_user", _fake_index)
    app = _build_app()

    status, body = await _request(app, "GET", "/api/v1/lists")
    assert status == 200
    assert isinstance(body, dict)
    assert body["meta"]["count"] == 1
    assert body["data"][0]["item_count"] == 3
    assert body["data"][0]["name"] == "A"


async def test_detail_returns_items_with_company_names(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    company_id = uuid.uuid4()

    async def _fake_get(_session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID) -> Any:
        return _fake_list(
            list_id, user_id, items=[_fake_item(company_id, name="Acme", note="prio")]
        )

    monkeypatch.setattr(lists_module, "get_list", _fake_get)
    app = _build_app()

    status, body = await _request(app, "GET", f"/api/v1/lists/{list_id}")
    assert status == 200
    assert isinstance(body, dict)
    assert body["data"]["item_count"] == 1
    item = body["data"]["items"][0]
    assert item["company_id"] == str(company_id)
    assert item["company_name"] == "Acme"
    assert item["note"] == "prio"


async def test_rename_list(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()

    async def _fake_rename(
        _session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID, name: str
    ) -> Any:
        return _fake_list(list_id, user_id, name=name)

    monkeypatch.setattr(lists_module, "rename_list", _fake_rename)
    app = _build_app()

    status, body = await _request(
        app, "PATCH", f"/api/v1/lists/{list_id}", json={"name": "Renamed"}
    )
    assert status == 200
    assert isinstance(body, dict)
    assert body["data"]["name"] == "Renamed"


async def test_delete_list(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    called: dict[str, Any] = {}

    async def _fake_delete(_session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID) -> None:
        called["list_id"] = list_id
        called["user_id"] = user_id

    monkeypatch.setattr(lists_module, "delete_list", _fake_delete)
    app = _build_app()

    status, body = await _request(app, "DELETE", f"/api/v1/lists/{list_id}")
    assert status == 200
    assert isinstance(body, dict)
    assert body["data"]["status"] == "deleted"
    assert called["list_id"] == list_id


async def test_add_item(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    company_id = uuid.uuid4()

    async def _fake_add(
        _session: Any,
        *,
        list_id: uuid.UUID,
        user_id: uuid.UUID,
        company_id: uuid.UUID,
        note: str | None = None,
    ) -> Any:
        return _fake_item(company_id, note=note)

    async def _fake_get(_session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID) -> Any:
        return _fake_list(
            list_id, user_id, items=[_fake_item(company_id, name="Acme", note="vip")]
        )

    monkeypatch.setattr(lists_module, "add_item", _fake_add)
    monkeypatch.setattr(lists_module, "get_list", _fake_get)
    app = _build_app()

    status, body = await _request(
        app,
        "POST",
        f"/api/v1/lists/{list_id}/items",
        json={"company_id": str(company_id), "note": "vip"},
    )
    assert status == 201
    assert isinstance(body, dict)
    assert body["data"]["company_id"] == str(company_id)
    assert body["data"]["note"] == "vip"
    assert body["data"]["company_name"] == "Acme"


async def test_patch_item_note(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    company_id = uuid.uuid4()

    async def _fake_patch(
        _session: Any,
        *,
        list_id: uuid.UUID,
        user_id: uuid.UUID,
        company_id: uuid.UUID,
        note: str | None,
    ) -> Any:
        return _fake_item(company_id, note=note)

    async def _fake_get(_session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID) -> Any:
        return _fake_list(
            list_id, user_id, items=[_fake_item(company_id, note="updated note")]
        )

    monkeypatch.setattr(lists_module, "update_item_note", _fake_patch)
    monkeypatch.setattr(lists_module, "get_list", _fake_get)
    app = _build_app()

    status, body = await _request(
        app,
        "PATCH",
        f"/api/v1/lists/{list_id}/items/{company_id}",
        json={"note": "updated note"},
    )
    assert status == 200
    assert isinstance(body, dict)
    assert body["data"]["note"] == "updated note"


async def test_remove_item(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    company_id = uuid.uuid4()

    async def _fake_remove(
        _session: Any,
        *,
        list_id: uuid.UUID,
        user_id: uuid.UUID,
        company_id: uuid.UUID,
    ) -> None:
        return None

    monkeypatch.setattr(lists_module, "remove_item", _fake_remove)
    app = _build_app()

    status, body = await _request(
        app, "DELETE", f"/api/v1/lists/{list_id}/items/{company_id}"
    )
    assert status == 200
    assert isinstance(body, dict)
    assert body["data"]["status"] == "removed"


async def test_export_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    company_id = uuid.uuid4()

    async def _fake_get(_session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID) -> Any:
        return _fake_list(
            list_id, user_id, name="Hot Leads", items=[_fake_item(company_id, note="vip")]
        )

    monkeypatch.setattr(lists_module, "get_list", _fake_get)
    app = _build_app()

    status, body = await _request(app, "GET", f"/api/v1/lists/{list_id}/export.csv")
    assert status == 200
    assert isinstance(body, str)
    # CSV header + one row with the company info
    lines = body.strip().splitlines()
    assert lines[0].startswith("company_id,name,country")
    assert str(company_id) in lines[1]
    assert "Acme LLP" in lines[1]
    assert "vip" in lines[1]


# ─── edge cases ────────────────────────────────────────────────────────────────


async def test_get_list_not_owned_returns_403(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()

    async def _fake_get(_session: Any, *, list_id: uuid.UUID, user_id: uuid.UUID) -> Any:
        raise ForbiddenError("nope", code="LIST_NOT_OWNED")

    monkeypatch.setattr(lists_module, "get_list", _fake_get)
    app = _build_app()

    status, body = await _request(app, "GET", f"/api/v1/lists/{list_id}")
    assert status == 403
    assert isinstance(body, dict)
    assert body["errors"][0]["code"] == "LIST_NOT_OWNED"


async def test_add_item_to_missing_list_returns_404(monkeypatch: pytest.MonkeyPatch) -> None:
    list_id = uuid.uuid4()
    company_id = uuid.uuid4()

    async def _fake_add(
        _session: Any,
        *,
        list_id: uuid.UUID,
        user_id: uuid.UUID,
        company_id: uuid.UUID,
        note: str | None = None,
    ) -> Any:
        raise NotFoundError("missing", code="LIST_NOT_FOUND")

    monkeypatch.setattr(lists_module, "add_item", _fake_add)
    app = _build_app()

    status, body = await _request(
        app,
        "POST",
        f"/api/v1/lists/{list_id}/items",
        json={"company_id": str(company_id)},
    )
    assert status == 404
    assert isinstance(body, dict)
    assert body["errors"][0]["code"] == "LIST_NOT_FOUND"


async def test_create_with_duplicate_name_returns_422(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_create(_session: Any, *, user_id: uuid.UUID, name: str) -> Any:
        raise ValidationError("dup", code="LIST_NAME_DUPLICATE")

    monkeypatch.setattr(lists_module, "create_list", _fake_create)
    app = _build_app()

    status, body = await _request(app, "POST", "/api/v1/lists", json={"name": "Dup"})
    assert status == 422
    assert isinstance(body, dict)
    assert body["errors"][0]["code"] == "LIST_NAME_DUPLICATE"


async def test_endpoints_require_auth() -> None:
    app = FastAPI()
    app.include_router(lists_module.router, prefix="/api/v1/lists", tags=["lists"])
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    app.dependency_overrides[get_session] = _empty_session
    # Do NOT override get_current_user — the real one runs and rejects.

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/lists")
    assert resp.status_code == 401
    payload = resp.json()
    assert payload["errors"][0]["code"] in {"MISSING_TOKEN", "UNAUTHORIZED"}
