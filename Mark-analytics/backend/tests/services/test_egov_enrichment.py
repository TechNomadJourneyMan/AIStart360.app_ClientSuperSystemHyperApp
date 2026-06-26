"""Tests for `app.services.egov_enrichment`.

Spec: docs/aistart360/07-product-redesign.md §6 Source 3 + §11 PR #8

All upstream HTTP and Redis calls are mocked — these tests must run with
no network and no docker dependencies (so they stay outside the
`integration` marker).
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest

from app.services import egov_enrichment as svc
from app.services.egov_enrichment import (
    EgovEnrichmentResult,
    _MissSentinel,
    _parse_response,
    enrich_by_bin,
)

# ────────────────────────────────────────────────────────────────────
# Fake Redis
# ────────────────────────────────────────────────────────────────────


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}
        self.expirations: dict[str, int] = {}

    async def get(self, key: str) -> bytes | None:
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: bytes | str) -> None:
        self.store[key] = value if isinstance(value, bytes) else value.encode("utf-8")
        self.expirations[key] = ttl

    async def incr(self, key: str) -> int:
        cur = int(self.store.get(key, b"0").decode("utf-8")) + 1
        self.store[key] = str(cur).encode("utf-8")
        return cur

    async def expire(self, key: str, ttl: int) -> None:
        self.expirations[key] = ttl


@pytest.fixture(autouse=True)
def _isolate_module_state(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    """Replace `_redis` with a fresh FakeRedis per test."""
    fake = FakeRedis()

    async def _fake_redis() -> Any:
        return fake

    monkeypatch.setattr(svc, "_redis", _fake_redis)
    # Disable sleeps so retry tests run instantly.
    async def _no_sleep(*_a: Any, **_kw: Any) -> None:
        return None

    monkeypatch.setattr(svc, "_sleep_backoff", _no_sleep)
    return fake


# ────────────────────────────────────────────────────────────────────
# Mock httpx.AsyncClient
# ────────────────────────────────────────────────────────────────────


class _MockClient:
    """Minimal AsyncClient stub recording calls and returning canned responses."""

    def __init__(self, responses: list[Any]) -> None:
        self._responses = list(responses)
        self.calls = 0

    async def get(self, url: str, *, params: dict[str, Any] | None = None,
                  headers: dict[str, str] | None = None) -> httpx.Response:
        self.calls += 1
        if not self._responses:
            raise AssertionError("No more canned responses")
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        req = httpx.Request("GET", url, params=params)
        if isinstance(item, httpx.Response):
            item._request = req  # type: ignore[attr-defined]
            return item
        status, body = item
        resp = httpx.Response(status, json=body, request=req)
        return resp

    async def aclose(self) -> None:
        return None


# ────────────────────────────────────────────────────────────────────
# Tests
# ────────────────────────────────────────────────────────────────────


SAMPLE_BIN = "123456789012"


def _stat_kz_payload() -> dict[str, Any]:
    return {
        "result": {
            "director": "Иванов И. И.",
            "status": "active",
            "registration_date": "2014-03-15",
            "legal_form": "ТОО",
            "address": "г. Алматы, ул. Абая, 1",
            "oked": "62.01",
        }
    }


async def test_valid_bin_returns_parsed_payload() -> None:
    client = _MockClient([(200, _stat_kz_payload())])

    result = await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    assert result is not None
    assert isinstance(result, EgovEnrichmentResult)
    assert result.director_name == "Иванов И. И."
    assert result.registration_status == "active"
    assert result.registration_date == date(2014, 3, 15)
    assert result.legal_form == "ТОО"
    assert result.address_full == "г. Алматы, ул. Абая, 1"
    assert result.oked_code == "62.01"
    assert client.calls == 1


async def test_404_returns_none_and_writes_missing_sentinel(
    _isolate_module_state: FakeRedis,
) -> None:
    client = _MockClient([(404, {})])

    result = await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    assert result is None
    # Sentinel persisted under cache key.
    cached_raw = _isolate_module_state.store.get(f"egov:bin:{SAMPLE_BIN}")
    assert cached_raw is not None
    cached = json.loads(cached_raw)
    assert cached == {"__missing__": True}
    assert _isolate_module_state.expirations[f"egov:bin:{SAMPLE_BIN}"] == 24 * 3600


async def test_http_500_three_times_raises_after_retries() -> None:
    client = _MockClient([(500, {}), (500, {}), (500, {})])

    with pytest.raises(httpx.HTTPStatusError):
        await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]
    assert client.calls == 3


async def test_cache_hit_skips_upstream(_isolate_module_state: FakeRedis) -> None:
    # Prime the cache as a successful result.
    cached_result = EgovEnrichmentResult(
        director_name="Cached Person",
        registration_status="active",
        registration_date=date(2020, 1, 1),
        legal_form="ТОО",
        address_full="addr",
        oked_code="62.01",
    )
    _isolate_module_state.store[f"egov:bin:{SAMPLE_BIN}"] = json.dumps(
        cached_result.to_jsonable(), ensure_ascii=False
    ).encode("utf-8")

    client = _MockClient([])  # Any call would AssertionError.

    result = await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    assert result is not None
    assert result.director_name == "Cached Person"
    assert result.registration_date == date(2020, 1, 1)
    assert client.calls == 0


async def test_missing_sentinel_in_cache_prevents_upstream_call(
    _isolate_module_state: FakeRedis,
) -> None:
    _isolate_module_state.store[f"egov:bin:{SAMPLE_BIN}"] = b'{"__missing__": true}'

    client = _MockClient([])

    result = await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    assert result is None
    assert client.calls == 0


async def test_invalid_bin_returns_none_without_upstream() -> None:
    client = _MockClient([])
    result = await enrich_by_bin("not-a-bin", http_client=client)  # type: ignore[arg-type]
    assert result is None
    assert client.calls == 0


async def test_parser_handles_dd_mm_yyyy_date() -> None:
    payload = {
        "data": {
            "head": "Petr",
            "regDate": "15.03.2014",
            "okedCode": "62.01",
        }
    }
    parsed = _parse_response(payload)
    assert parsed is not None
    assert parsed.director_name == "Petr"
    assert parsed.registration_date == date(2014, 3, 15)
    assert parsed.oked_code == "62.01"


async def test_parser_returns_none_for_empty_body() -> None:
    assert _parse_response({}) is None
    assert _parse_response({"result": {}}) is None


async def test_retry_then_success(
    _isolate_module_state: FakeRedis,
) -> None:
    client = _MockClient([(500, {}), (200, _stat_kz_payload())])

    result = await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    assert result is not None
    assert result.director_name == "Иванов И. И."
    assert client.calls == 2


async def test_successful_result_is_cached_for_thirty_days(
    _isolate_module_state: FakeRedis,
) -> None:
    client = _MockClient([(200, _stat_kz_payload())])

    await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    key = f"egov:bin:{SAMPLE_BIN}"
    assert key in _isolate_module_state.store
    assert _isolate_module_state.expirations[key] == 30 * 24 * 3600


async def test_cache_get_decode_failure_falls_through_to_upstream(
    _isolate_module_state: FakeRedis,
) -> None:
    _isolate_module_state.store[f"egov:bin:{SAMPLE_BIN}"] = b"not-json"
    client = _MockClient([(200, _stat_kz_payload())])

    result = await enrich_by_bin(SAMPLE_BIN, http_client=client)  # type: ignore[arg-type]

    assert result is not None
    assert client.calls == 1


# ────────────────────────────────────────────────────────────────────
# Sentinel type
# ────────────────────────────────────────────────────────────────────


def test_miss_sentinel_is_singleton() -> None:
    assert isinstance(svc._CACHE_MISS_SENTINEL, _MissSentinel)


# Keep linter happy — AsyncMock is referenced for future expansion.
_ = AsyncMock
