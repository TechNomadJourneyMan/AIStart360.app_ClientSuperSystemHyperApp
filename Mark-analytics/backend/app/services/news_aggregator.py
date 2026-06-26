"""RSS news aggregator.

Fetches a small set of free Kazakhstan business news RSS feeds in parallel,
normalises items, and caches the merged result in-process for 5 minutes.

No DB, no Redis dep — keeps the endpoint cheap and resilient. If every
feed fails, callers should return an empty list with `meta.degraded=True`.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import feedparser
import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)


# ─── Config ────────────────────────────────────────────────────────────

FEEDS: tuple[tuple[str, str], ...] = (
    ("Forbes Kazakhstan", "https://forbes.kz/rss"),
    ("Kursiv", "https://kursiv.media/feed/"),
    ("Inbusiness", "https://inbusiness.kz/ru/rss"),
)

FEED_TIMEOUT_S: float = 5.0
CACHE_TTL_S: float = 300.0  # 5 minutes
USER_AGENT: str = "MarkAnalyticsNewsBot/1.0 (+https://mark.analytics)"


# ─── Types ─────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class NewsItem:
    id: str
    title: str
    url: str
    source: str
    published_at: str  # ISO-8601 UTC
    summary: str

    def as_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "published_at": self.published_at,
            "summary": self.summary,
        }


# ─── Cache ─────────────────────────────────────────────────────────────


_cache: dict[str, Any] = {
    "items": [],  # list[NewsItem]
    "cached_at": 0.0,
    "degraded": True,
}
_cache_lock = asyncio.Lock()


def _cache_fresh() -> bool:
    return (time.time() - float(_cache["cached_at"])) < CACHE_TTL_S and bool(_cache["items"])


# ─── Parsing helpers ───────────────────────────────────────────────────


def _sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8"), usedforsecurity=False).hexdigest()


def _parse_published(entry: Any) -> datetime:
    # feedparser exposes a struct_time in `*_parsed`; prefer that.
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        val = getattr(entry, key, None) or (entry.get(key) if isinstance(entry, dict) else None)
        if val:
            try:
                return datetime(*val[:6], tzinfo=UTC)
            except (TypeError, ValueError):
                continue

    # Fallback: RFC-822 string parse.
    for key in ("published", "updated", "created"):
        raw = getattr(entry, key, None) or (entry.get(key) if isinstance(entry, dict) else None)
        if raw:
            try:
                dt = parsedate_to_datetime(raw)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                return dt.astimezone(UTC)
            except (TypeError, ValueError):
                continue

    return datetime.now(tz=UTC)


def _clean(text: str | None, *, max_len: int = 300) -> str:
    if not text:
        return ""
    # Strip HTML tags cheaply — feedparser already decodes entities.
    out: list[str] = []
    in_tag = False
    for ch in text:
        if ch == "<":
            in_tag = True
            continue
        if ch == ">":
            in_tag = False
            continue
        if not in_tag:
            out.append(ch)
    cleaned = "".join(out).strip()
    if len(cleaned) > max_len:
        cleaned = cleaned[: max_len - 1].rstrip() + "…"
    return cleaned


def _normalise_entry(source: str, entry: Any) -> NewsItem | None:
    title = _clean(getattr(entry, "title", None) or "")
    url = getattr(entry, "link", None) or ""
    if not title or not url:
        return None
    published = _parse_published(entry)
    summary = _clean(
        getattr(entry, "summary", None) or getattr(entry, "description", None) or ""
    )
    return NewsItem(
        id=_sha1(url),
        title=title,
        url=url,
        source=source,
        published_at=published.isoformat().replace("+00:00", "Z"),
        summary=summary,
    )


# ─── Fetch ─────────────────────────────────────────────────────────────


async def _fetch_one(client: httpx.AsyncClient, source: str, url: str) -> list[NewsItem]:
    try:
        resp = await client.get(url, timeout=FEED_TIMEOUT_S)
        resp.raise_for_status()
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.warning("news_feed_fetch_failed", source=source, url=url, error=str(exc))
        return []

    # feedparser is sync + CPU-bound; offload to a thread to avoid stalling.
    parsed = await asyncio.to_thread(feedparser.parse, resp.content)
    items: list[NewsItem] = []
    for entry in getattr(parsed, "entries", []) or []:
        item = _normalise_entry(source, entry)
        if item is not None:
            items.append(item)
    return items


async def _refresh() -> tuple[list[NewsItem], bool]:
    """Hit all feeds in parallel. Returns (items, degraded)."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, */*"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        results = await asyncio.gather(
            *(_fetch_one(client, name, url) for name, url in FEEDS),
            return_exceptions=True,
        )

    merged: list[NewsItem] = []
    successes = 0
    for r in results:
        if isinstance(r, BaseException):
            logger.warning("news_feed_unexpected_error", error=str(r))
            continue
        if r:
            successes += 1
        merged.extend(r)

    merged.sort(key=lambda item: item.published_at, reverse=True)
    degraded = successes == 0
    return merged, degraded


# ─── Public API ────────────────────────────────────────────────────────


async def fetch_recent_news(limit: int) -> tuple[list[NewsItem], dict[str, Any]]:
    """Return up to `limit` most recent news items + a meta dict.

    Meta keys: `cached_at` (epoch float), `degraded` (bool).
    """
    limit = max(1, min(limit, 100))

    if _cache_fresh():
        items = list(_cache["items"])[:limit]
        return items, {
            "cached_at": float(_cache["cached_at"]),
            "degraded": bool(_cache["degraded"]),
        }

    async with _cache_lock:
        # Re-check after acquiring the lock (another coroutine may have refreshed).
        if _cache_fresh():
            items = list(_cache["items"])[:limit]
            return items, {
                "cached_at": float(_cache["cached_at"]),
                "degraded": bool(_cache["degraded"]),
            }

        fresh, degraded = await _refresh()
        # Only overwrite the cache when we actually got items; otherwise keep
        # the previous payload around so widgets aren't blanked on a transient
        # network blip.
        if fresh:
            _cache["items"] = fresh
            _cache["cached_at"] = time.time()
            _cache["degraded"] = degraded
        else:
            _cache["cached_at"] = time.time()
            _cache["degraded"] = True

        items = list(_cache["items"])[:limit]
        return items, {
            "cached_at": float(_cache["cached_at"]),
            "degraded": bool(_cache["degraded"]),
        }


# ─── DB persistence (write-through / read-through) ───────────────────────


def _parse_iso(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


async def store_news_items(session: AsyncSession, items: list[NewsItem]) -> int:
    """Write-through: upsert fetched items into `news_items`.

    Conflict on `url` updates the mutable fields (title/summary/published_at/
    source) and refreshes `fetched_at`. Best-effort: if the table is missing
    (migration not yet applied) or any DB error occurs, we log and return 0 so
    the request still succeeds on live RSS data.
    """
    if not items:
        return 0

    from app.models.news_item import NewsItemRecord

    rows = []
    for it in items:
        published = _parse_iso(it.published_at)
        rows.append(
            {
                "id": it.id,
                "source": it.source,
                "title": it.title,
                "url": it.url,
                "summary": it.summary or None,
                "published_at": published,
                "tags": None,
                "fetched_at": datetime.now(tz=UTC),
            }
        )

    stmt = pg_insert(NewsItemRecord).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[NewsItemRecord.url],
        set_={
            "source": stmt.excluded.source,
            "title": stmt.excluded.title,
            "summary": stmt.excluded.summary,
            "published_at": stmt.excluded.published_at,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    try:
        await session.execute(stmt)
        await session.commit()
        return len(rows)
    except Exception as exc:  # noqa: BLE001 — best-effort persistence
        await session.rollback()
        logger.warning("news_persist_failed", error=str(exc))
        return 0


async def read_stored_news(session: AsyncSession, limit: int) -> list[NewsItem]:
    """Read-through: load stored news ordered by published_at desc.

    Best-effort: returns [] if the table is missing or a DB error occurs.
    """
    from app.models.news_item import NewsItemRecord

    stmt = (
        select(NewsItemRecord)
        .order_by(NewsItemRecord.published_at.desc().nulls_last())
        .limit(limit)
    )
    try:
        rows = (await session.execute(stmt)).scalars().all()
    except Exception as exc:  # noqa: BLE001 — best-effort read-through
        await session.rollback()
        logger.warning("news_read_stored_failed", error=str(exc))
        return []

    out: list[NewsItem] = []
    for r in rows:
        published = (
            r.published_at.isoformat().replace("+00:00", "Z")
            if r.published_at is not None
            else datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
        )
        out.append(
            NewsItem(
                id=r.id,
                title=r.title,
                url=r.url,
                source=r.source,
                published_at=published,
                summary=r.summary or "",
            )
        )
    return out


def _merge_dedup(*lists: list[NewsItem]) -> list[NewsItem]:
    """Merge news lists, de-duplicating by url, ordered by published_at desc."""
    seen: set[str] = set()
    merged: list[NewsItem] = []
    for lst in lists:
        for it in lst:
            if it.url in seen:
                continue
            seen.add(it.url)
            merged.append(it)
    merged.sort(key=lambda item: item.published_at, reverse=True)
    return merged


async def fetch_recent_news_persisted(
    session: AsyncSession, limit: int,
) -> tuple[list[NewsItem], dict[str, Any]]:
    """DB-backed variant of `fetch_recent_news`.

    1. Fetch fresh items via the in-process RSS cache.
    2. Write-through fresh items into `news_items` (best-effort).
    3. Merge fresh + stored (dedup by url), order by published_at desc.

    When RSS is degraded (every feed failed / cache cold), the stored rows
    keep the endpoint useful. `meta.source` reflects what produced the data.
    """
    limit = max(1, min(limit, 100))

    fresh, meta = await fetch_recent_news(limit=limit)

    persisted_count = 0
    if fresh:
        persisted_count = await store_news_items(session, fresh)

    stored = await read_stored_news(session, limit=limit)
    merged = _merge_dedup(fresh, stored)[:limit]

    if fresh and stored:
        data_source = "merged"
    elif fresh:
        data_source = "rss"
    elif stored:
        data_source = "db"
    else:
        data_source = "empty"

    out_meta: dict[str, Any] = {
        "cached_at": meta["cached_at"],
        "degraded": meta["degraded"],
        "source": data_source,
        "stored_count": len(stored),
        "persisted": persisted_count,
    }
    return merged, out_meta


def _reset_cache_for_tests() -> None:
    """Test-only helper; safe to import."""
    _cache["items"] = []
    _cache["cached_at"] = 0.0
    _cache["degraded"] = True
