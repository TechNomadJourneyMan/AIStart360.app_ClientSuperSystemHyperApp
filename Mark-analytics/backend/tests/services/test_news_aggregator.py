"""Unit tests for the RSS news aggregator.

We mock httpx with respx so no network is touched and we can assert
sort-order, dedupe behaviour, and graceful degradation when feeds fail.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from app.services import news_aggregator
from app.services.news_aggregator import FEEDS, fetch_recent_news


def _rss(items: list[tuple[str, str, str]]) -> str:
    """Build a tiny RSS 2.0 document. Each item = (title, link, pubDate)."""
    body = "\n".join(
        f"<item><title>{t}</title><link>{link}</link>"
        f"<description>summary of {t}</description>"
        f"<pubDate>{d}</pubDate></item>"
        for t, link, d in items
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel><title>x</title>'
        f"{body}</channel></rss>"
    )


@pytest.fixture(autouse=True)
def _reset_cache() -> None:
    news_aggregator._reset_cache_for_tests()


@pytest.mark.asyncio
async def test_fetch_recent_news_sorts_and_limits() -> None:
    feed_a = _rss(
        [
            ("Old A", "https://a.example/1", "Mon, 01 Jan 2024 10:00:00 +0000"),
            ("New A", "https://a.example/2", "Wed, 10 Jan 2024 10:00:00 +0000"),
        ]
    )
    feed_b = _rss(
        [
            ("Newest B", "https://b.example/1", "Fri, 12 Jan 2024 10:00:00 +0000"),
        ]
    )
    feed_c = _rss(
        [
            ("Mid C", "https://c.example/1", "Tue, 09 Jan 2024 10:00:00 +0000"),
        ]
    )
    payloads = [feed_a, feed_b, feed_c]

    with respx.mock(assert_all_called=False) as router:
        for (_, url), body in zip(FEEDS, payloads, strict=True):
            router.get(url).mock(
                return_value=httpx.Response(200, content=body.encode("utf-8"))
            )

        items, meta = await fetch_recent_news(limit=2)

    assert len(items) == 2
    titles = [i.title for i in items]
    assert titles == ["Newest B", "New A"]
    assert meta["degraded"] is False
    # IDs are sha1 of URL.
    assert all(len(i.id) == 40 for i in items)
    # ISO Z-suffixed timestamps.
    assert all(i.published_at.endswith("Z") for i in items)


@pytest.mark.asyncio
async def test_fetch_recent_news_partial_failure_keeps_serving() -> None:
    good = _rss(
        [("Hello", "https://a.example/1", "Wed, 10 Jan 2024 10:00:00 +0000")]
    )
    with respx.mock(assert_all_called=False) as router:
        urls = [u for _, u in FEEDS]
        router.get(urls[0]).mock(
            return_value=httpx.Response(200, content=good.encode("utf-8"))
        )
        router.get(urls[1]).mock(return_value=httpx.Response(500))
        router.get(urls[2]).mock(side_effect=httpx.ConnectError("boom"))

        items, meta = await fetch_recent_news(limit=10)

    assert len(items) == 1
    assert items[0].title == "Hello"
    assert items[0].source == FEEDS[0][0]
    assert meta["degraded"] is False  # at least one feed succeeded


@pytest.mark.asyncio
async def test_fetch_recent_news_all_fail_degraded() -> None:
    with respx.mock(assert_all_called=False) as router:
        for _, url in FEEDS:
            router.get(url).mock(return_value=httpx.Response(503))

        items, meta = await fetch_recent_news(limit=10)

    assert items == []
    assert meta["degraded"] is True
