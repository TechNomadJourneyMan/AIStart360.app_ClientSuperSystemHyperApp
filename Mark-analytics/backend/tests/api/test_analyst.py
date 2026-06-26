"""Tests for the MK Analyst chat endpoint (Track A).

We mock the AI Gateway with a scripted sequence of `GenerateResponse` envelopes
so the endpoint exercises the full tool-call loop without hitting any provider.
DB and Redis are stubbed via dependency overrides + monkeypatch on the service
module.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.ai.types import GenerateResponse, Provider, Usage
# Import the analyst router module directly to avoid pulling unrelated
# Track-B siblings (e.g. `digests`) through `app/api/v1/__init__.py`.
import importlib
analyst_module = importlib.import_module("app.api.v1.analyst")
from app.core.deps import get_current_user, get_optional_user, get_session
from app.core.errors import (
    AppError,
    app_error_handler,
    http_handler,
    validation_handler,
)
from app.core.security import SupabaseUserClaims
from app.services import analyst as analyst_service


def _claims() -> SupabaseUserClaims:
    return SupabaseUserClaims(
        user_id="11111111-1111-1111-1111-111111111111",
        email="bd-lead@example.com",
        role="authenticated",
        app_metadata={"plan": "pro"},
        user_metadata={},
        raw={},
    )


async def _empty_session() -> AsyncIterator[None]:
    yield None


def _build_app() -> FastAPI:
    test_app = FastAPI()
    test_app.include_router(analyst_module.router, prefix="/api/v1/analyst", tags=["analyst"])
    test_app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    test_app.dependency_overrides[get_session] = _empty_session
    return test_app


def _mock_response(text: str) -> GenerateResponse:
    return GenerateResponse(
        text=text,
        parsed=None,
        model_used="mock/mk-analyst",
        provider=Provider.MOCK,
        usage=Usage(tokens_in=10, tokens_out=10, cost_usd=0.0, latency_ms=1),
        finish_reason="stop",
    )


@pytest.fixture
def patched(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Stub gateway + Redis + quota + tools used by `run_analyst_turn`."""
    state: dict[str, Any] = {
        "gateway_outputs": [],   # populated per-test (FIFO)
        "history_store": {},     # conversation_id -> list[dict]
        "quota_raise": False,
        "company_rows": [
            SimpleNamespace(
                id=uuid4(),
                name="Mock Kaspi.kz",
                industry_code="62.01",
                industry_label="Software",
                country="KZ",
                region_kato=None,
            )
        ],
    }

    async def fake_generate(req: Any) -> GenerateResponse:
        if not state["gateway_outputs"]:
            return _mock_response('{"final": "no more scripted output"}')
        return state["gateway_outputs"].pop(0)

    monkeypatch.setattr(analyst_service.gateway, "generate", fake_generate)

    async def fake_load(conv_id: str) -> list[Any]:
        from app.ai.types import ChatMessage as CM

        raw = state["history_store"].get(conv_id, [])
        return [CM(**m) for m in raw]

    async def fake_save(conv_id: str, msgs: list[Any]) -> None:
        state["history_store"][conv_id] = [m.model_dump() for m in msgs]

    monkeypatch.setattr(analyst_service, "_load_history", fake_load)
    monkeypatch.setattr(analyst_service, "_save_history", fake_save)

    async def fake_check_quota(_session: Any, _user_id: Any) -> None:
        if state["quota_raise"]:
            from app.core.errors import QuotaExceededError

            raise QuotaExceededError(
                "Monthly request limit (5) reached.",
                kind="analyst", used=5, limit=5, tier="free",
            )

    monkeypatch.setattr(analyst_service, "_check_and_increment_quota", fake_check_quota)

    async def fake_list_companies(*args: Any, **kwargs: Any) -> tuple[list[Any], None, int]:
        return state["company_rows"], None, len(state["company_rows"])

    monkeypatch.setattr(
        "app.services.companies.list_companies", fake_list_companies,
    )

    return state


async def _post(test_app: FastAPI, body: dict[str, Any], *, auth: bool = True) -> tuple[int, dict[str, Any]]:
    transport = ASGITransport(app=test_app)
    headers = {"Authorization": "Bearer test"} if auth else {}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/analyst/query", json=body, headers=headers)
    return resp.status_code, resp.json()


async def test_single_tool_call_returns_envelope(patched: dict[str, Any]) -> None:
    """Scripted: model first asks `search_companies`, then emits `final`.

    Verifies the response envelope shape end-to-end:
      - data.conversation_id is a non-empty string
      - data.message contains the final assistant text
      - data.tool_calls has one entry for `search_companies`
      - data.actions includes both `apply_filter` (from search) and… well,
        an apply_filter chip is enough for v1.
    """
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims
    test_app.dependency_overrides[get_optional_user] = _claims

    patched["gateway_outputs"] = [
        # Turn 1: tool call
        _mock_response(
            '{"tool": "search_companies", "input": {"industry": "62.01", "country": "KZ"}}'
        ),
        # Turn 2: final answer
        _mock_response('{"final": "Найдена 1 IT-компания: **Mock Kaspi.kz**."}'),
    ]

    status, body = await _post(
        test_app,
        {"query": "Какие IT-компании в KZ?"},
    )

    assert status == 200, body
    data = body["data"]
    assert isinstance(data["conversation_id"], str) and data["conversation_id"]
    assert "Mock Kaspi.kz" in data["message"]
    assert len(data["tool_calls"]) == 1
    tc = data["tool_calls"][0]
    assert tc["name"] == "search_companies"
    assert tc["input"]["industry"] == "62.01"
    assert tc["error"] is None
    # The search call yields an apply_filter chip.
    action_types = {a["type"] for a in data["actions"]}
    assert "apply_filter" in action_types


async def test_direct_final_no_tool_calls(patched: dict[str, Any]) -> None:
    """Model can answer without any tool call. Envelope still well-formed."""
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims
    test_app.dependency_overrides[get_optional_user] = _claims

    patched["gateway_outputs"] = [
        _mock_response('{"final": "Здесь короткий ответ без вызова инструментов."}'),
    ]

    status, body = await _post(test_app, {"query": "Привет"})

    assert status == 200, body
    data = body["data"]
    assert data["tool_calls"] == []
    assert data["actions"] == []
    assert "короткий ответ" in data["message"]


async def test_tool_budget_cap_enforced(patched: dict[str, Any]) -> None:
    """If the model keeps calling tools, we cap at MAX_TOOL_CALLS_PER_TURN=4.

    We script 5 consecutive tool calls; the loop must execute exactly 4 and
    then emit a fallback final message.
    """
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims
    test_app.dependency_overrides[get_optional_user] = _claims

    tool_msg = _mock_response(
        '{"tool": "search_companies", "input": {"query": "x"}}'
    )
    # 5 tool calls, then a final.
    patched["gateway_outputs"] = [tool_msg, tool_msg, tool_msg, tool_msg, tool_msg,
                                   _mock_response('{"final": "stop"}')]

    status, body = await _post(test_app, {"query": "loop"})

    assert status == 200, body
    data = body["data"]
    assert len(data["tool_calls"]) == 4  # cap


async def test_unknown_tool_falls_through_to_final(patched: dict[str, Any]) -> None:
    """If the model invents a tool name, we don't crash — we surface a final."""
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims
    test_app.dependency_overrides[get_optional_user] = _claims

    patched["gateway_outputs"] = [
        _mock_response('{"tool": "do_a_barrel_roll", "input": {}}'),
    ]

    status, body = await _post(test_app, {"query": "what"})
    assert status == 200, body
    assert "do_a_barrel_roll" in body["data"]["message"]
    assert body["data"]["tool_calls"] == []


async def test_quota_exceeded_returns_structured_error(patched: dict[str, Any]) -> None:
    """When `users.requests_used >= requests_limit`, we get a structured error."""
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims
    test_app.dependency_overrides[get_optional_user] = _claims
    patched["quota_raise"] = True

    status, body = await _post(test_app, {"query": "ping"})
    assert status == 429
    assert body["errors"][0]["code"] == "QUOTA_EXCEEDED"
    assert body["errors"][0]["kind"] == "analyst"
    assert body["errors"][0]["limit"] == 5


async def test_empty_query_rejected(patched: dict[str, Any]) -> None:
    test_app = _build_app()
    test_app.dependency_overrides[get_current_user] = _claims
    test_app.dependency_overrides[get_optional_user] = _claims

    status, body = await _post(test_app, {"query": "   "})
    assert status == 422
    assert any("VALIDATION" in e["code"] for e in body["errors"])
