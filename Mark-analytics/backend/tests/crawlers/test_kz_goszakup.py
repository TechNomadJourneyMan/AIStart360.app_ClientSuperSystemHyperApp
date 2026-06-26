"""Tests for the kz_goszakup HTML mirror spider.

Coverage
~~~~~~~~
- ``parse_listing`` parses preview fields from a snapshot fixture.
- ``parse_detail`` parses winner / procurement type / documents.
- Crawl walks listing → detail → empty page (stop signal).
- Throttle: ``asyncio.sleep`` is awaited at least once per request.
- 429 with ``Retry-After`` → backoff respected before retry.
- 403 → ``CrawlResult.status == 'blocked'``.
- ``persist_tenders`` upsert is idempotent (second run inserts 0 rows).
"""

from __future__ import annotations

import asyncio
import random
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.crawlers.spiders.kz_goszakup import (
    BASE,
    KzGoszakupSpider,
    parse_detail,
    parse_listing,
)

FIXTURES = Path(__file__).parent / "fixtures" / "kz_goszakup"


def _read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Pure parser tests
# ---------------------------------------------------------------------------


def test_parse_listing_extracts_expected_fields() -> None:
    items = parse_listing(_read("listing_page1.html"))
    assert len(items) == 2

    first = items[0]
    assert first["external_id"] == "12345678"
    assert first["detail_url"] == f"{BASE}/ru/announce/index/12345678"
    assert first["title"].startswith("Поставка офисной мебели")
    assert first["customer_bin_raw"] == "060840001234"
    assert "Городская больница" in (first["customer_name"] or "")
    assert first["status"] == "Опубликован"
    assert first["amount"] is not None
    # 15 750 000,00 → 15_750_000.00
    assert float(first["amount"]) == pytest.approx(15_750_000.0)
    assert first["deadline_at"] == datetime(2026, 6, 15, tzinfo=UTC)
    assert first["published_at"] == datetime(2026, 5, 28, tzinfo=UTC)

    second = items[1]
    assert second["customer_bin_raw"] == "020140000119"
    assert second["status"] == "Завершён"


def test_parse_listing_empty_returns_no_rows() -> None:
    assert parse_listing(_read("listing_empty.html")) == []


def test_parse_detail_extracts_winner_and_documents() -> None:
    detail = parse_detail(_read("detail_12345678.html"))
    assert detail["procurement_type"] == "Открытый конкурс"
    assert detail["winner_bin_raw"] == "070140000456"
    assert detail["winner_name"] == "ТОО «МебельСтрой Астана»"
    assert detail["published_at"] == datetime(2026, 5, 28, tzinfo=UTC)
    assert len(detail["documents"]) == 2
    assert all(d.startswith(BASE) for d in detail["documents"])


# ---------------------------------------------------------------------------
# Mock transport — drives crawl() without real network
# ---------------------------------------------------------------------------


class _Router:
    """Maps URL path → (status, body, headers)."""

    def __init__(self) -> None:
        self.routes: dict[str, tuple[int, str, dict[str, str]]] = {}
        self.calls: list[str] = []

    def add(
        self,
        path: str,
        body: str,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.routes[path] = (status, body, headers or {})

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(str(request.url))
        path = request.url.path
        if request.url.query:
            path = f"{path}?{request.url.query.decode()}"
        # Try exact match (with query), then path-only.
        if path in self.routes:
            status, body, headers = self.routes[path]
        elif request.url.path in self.routes:
            status, body, headers = self.routes[request.url.path]
        else:
            return httpx.Response(404, text="not found")
        return httpx.Response(status, text=body, headers=headers)


def _client(router: _Router) -> httpx.AsyncClient:
    transport = httpx.MockTransport(router.handler)
    return httpx.AsyncClient(transport=transport, base_url=BASE)


def _spider(**kw) -> KzGoszakupSpider:
    spider = KzGoszakupSpider(
        max_pages=kw.pop("max_pages", 3),
        request_delay=0.0,        # speed up tests
        jitter_ms=(0, 0),
        rng=random.Random(0),
        **kw,
    )
    spider.upload_to_r2 = False
    return spider


# ---------------------------------------------------------------------------
# Crawl walk
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_crawl_walks_listing_and_detail_then_stops_on_empty() -> None:
    router = _Router()
    router.add(
        "/ru/search/announce?count=50&page=1",
        _read("listing_page1.html"),
    )
    router.add(
        "/ru/search/announce?count=50&page=2",
        _read("listing_empty.html"),
    )
    router.add(
        "/ru/announce/index/12345678",
        _read("detail_12345678.html"),
    )
    # Reuse detail 1 fixture for the second tender too — same shape.
    router.add(
        "/ru/announce/index/12345679",
        _read("detail_12345678.html"),
    )

    spider = _spider(max_pages=5)
    async with _client(router) as client:
        result = await spider.crawl(client)

    assert result.status == "ok"
    assert len(result.tenders) == 2
    # 2 listing pages + 2 detail pages
    assert result.pages_fetched == 4
    sample = result.tenders[0].as_dict()
    assert sample["external_id"] == "12345678"
    assert sample["customer_bin_raw"] == "060840001234"
    assert sample["winner_bin_raw"] == "070140000456"
    assert sample["currency"] == "KZT"
    assert sample["procurement_type"] == "Открытый конкурс"


# ---------------------------------------------------------------------------
# Throttle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_throttle_sleeps_between_requests() -> None:
    router = _Router()
    router.add(
        "/ru/search/announce?count=50&page=1",
        _read("listing_page1.html"),
    )
    router.add(
        "/ru/search/announce?count=50&page=2",
        _read("listing_empty.html"),
    )
    router.add("/ru/announce/index/12345678", _read("detail_12345678.html"))
    router.add("/ru/announce/index/12345679", _read("detail_12345678.html"))

    real_sleep = asyncio.sleep
    sleep_calls: list[float] = []

    async def tracking_sleep(delay: float, *a, **kw):
        sleep_calls.append(delay)
        # Yield once but don't actually wait — tests must be fast.
        await real_sleep(0)

    spider = _spider(max_pages=3)
    with patch(
        "app.crawlers.spiders.kz_goszakup.asyncio.sleep",
        new=tracking_sleep,
    ):
        async with _client(router) as client:
            await spider.crawl(client)

    # 2 listing pages + 2 details = 4 requests = at least 4 sleep calls.
    assert len(sleep_calls) >= 4


# ---------------------------------------------------------------------------
# 429 with Retry-After
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retry_after_honoured_on_429() -> None:
    state = {"first": True}

    async def handler(request: httpx.Request) -> httpx.Response:
        if state["first"] and "page=1" in (request.url.query.decode() or ""):
            state["first"] = False
            return httpx.Response(429, headers={"Retry-After": "7"}, text="slow down")
        if request.url.path == "/ru/search/announce":
            return httpx.Response(200, text=_read("listing_empty.html"))
        return httpx.Response(404, text="nope")

    transport = httpx.MockTransport(handler)
    sleep_calls: list[float] = []
    real_sleep = asyncio.sleep

    async def tracking_sleep(delay: float, *a, **kw):
        sleep_calls.append(delay)
        await real_sleep(0)

    spider = _spider(max_pages=2)
    with patch(
        "app.crawlers.spiders.kz_goszakup.asyncio.sleep",
        new=tracking_sleep,
    ):
        async with httpx.AsyncClient(transport=transport, base_url=BASE) as client:
            result = await spider.crawl(client)

    # Retry-After value must be passed to asyncio.sleep at least once.
    assert 7.0 in sleep_calls
    # Spider still completes successfully after the backoff.
    assert result.status == "ok"


# ---------------------------------------------------------------------------
# 403 → blocked
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_403_marks_spider_blocked() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="forbidden")

    transport = httpx.MockTransport(handler)
    spider = _spider(max_pages=2)
    async with httpx.AsyncClient(transport=transport, base_url=BASE) as client:
        result = await spider.crawl(client)

    assert result.status == "blocked"
    assert result.tenders == []
    assert "403" in (result.reason or "")


# ---------------------------------------------------------------------------
# Idempotent upsert (logical test — no real DB)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persist_tenders_idempotent_counters() -> None:
    """Second run with identical input must report 0 new inserts.

    We mock the SQLAlchemy session so the test doesn't need a Postgres
    instance — the contract we assert is the spider-side counter logic:
    after the first run the scalar lookup returns an id, so the second
    run must be classified as 'updated' (0 inserts).
    """

    from app.crawlers.spiders.kz_goszakup import TenderRecord
    from app.crawlers.spiders.kz_goszakup_persist import persist_tenders

    tenders = [
        TenderRecord(
            external_id="12345678",
            title="Test",
            detail_url=f"{BASE}/ru/announce/index/12345678",
            customer_bin_raw="060840001234",
        )
    ]

    session = AsyncMock()
    # _resolve_bins query returns no companies.
    bin_rows = AsyncMock()
    bin_rows.__iter__ = lambda self: iter([])

    scalar_values = iter([None, "tender-uuid"])  # first run = insert, second = update

    async def scalar(_stmt):
        return next(scalar_values)

    async def execute(_stmt):
        result = AsyncMock()
        result.rowcount = 1
        result.__iter__ = lambda self: iter([])
        return result

    session.scalar = scalar
    session.execute = execute
    session.flush = AsyncMock()

    first = await persist_tenders(session, tenders)
    second = await persist_tenders(session, tenders)

    assert first["inserted"] == 1
    assert first["updated"] == 0
    assert second["inserted"] == 0
    assert second["updated"] == 1
