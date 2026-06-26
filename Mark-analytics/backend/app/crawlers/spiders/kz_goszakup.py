"""KZ Goszakup — HTML mirror spider (replaces 401 API).

Strategy
--------
The official API at ``ows.goszakup.gov.kz/v3`` returns ``401 Unauthorized`` for
anonymous calls (see ``docs/aistart360/07-product-redesign.md`` §11 PR #4).
The same data is reachable as plain HTML on the public search page at
``https://goszakup.gov.kz/ru/search/announce`` with simple pagination
(``?page=N&count=50``) — no auth wall.

Pipeline
~~~~~~~~
1. Walk the listing pages sequentially until either an empty page is hit or
   ``max_pages`` is reached.
2. For each row in the listing extract the preview fields (title, customer
   BIN, amount, status, deadline, detail URL).
3. Fetch each detail page and pull extra fields (winner BIN if awarded,
   procurement type, document links list).
4. Upsert into the ``tenders`` table by ``(source, external_id)``.
5. Persist every fetched HTML page into ``pages`` (and R2 if configured).

Anti-bot hygiene
~~~~~~~~~~~~~~~~
- Rotating User-Agent from a small desktop pool (Chrome/Firefox/Edge).
- Global throttle of 1 req/sec via ``asyncio.Semaphore(1)`` + sleep.
- Random jitter of 200-800 ms between requests.
- ``Retry-After`` header is honoured on ``429``.
- ``403`` is treated as IP-blocked — the spider exits with status
  ``"blocked"`` so the dispatcher can re-try in 4h.

Field mapping (HTML selector → tender column)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Listing row (``table.search-table > tbody > tr``):

==============================  ==================================
HTML node                       Tender field
==============================  ==================================
``td.t-number > a``             ``external_id`` + ``detail_url``
``td.t-name``                   ``title``
``td.t-customer``               ``customer_name`` (+ embedded BIN)
``td.t-customer`` (BIN regex)   ``customer_bin_raw``
``td.t-sum``                    ``amount`` (KZT, parsed)
``td.t-status``                 ``status``
``td.t-deadline``               ``deadline_at`` (parsed dd.mm.yyyy)
==============================  ==================================

Detail page (``div.tender-detail``):

==============================  ==================================
HTML selector                   Tender field
==============================  ==================================
``[data-field=procurement]``    ``procurement_type``
``[data-field=published]``      ``published_at``
``[data-field=winner-bin]``     ``winner_bin_raw``
``[data-field=winner-name]``    ``winner_name``
``a.doc-link``                  ``documents[]``
==============================  ==================================

The spider stays tolerant of small markup drift — selectors fall back to
``<dt>/<dd>`` and ``<th>/<td>`` label lookups when structured ``data-field``
nodes are missing.
"""

from __future__ import annotations

import asyncio
import random
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from selectolax.parser import HTMLParser

from app.crawlers.base import FetchedPage, SimpleHttpSpider, url_hash

BASE = "https://goszakup.gov.kz"
LISTING_PATH = "/ru/search/announce"

# Small rotating UA pool — current major desktop browsers.
USER_AGENTS: tuple[str, ...] = (
    # Chrome 124 / macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    # Chrome 124 / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    # Firefox 125 / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) "
    "Gecko/20100101 Firefox/125.0",
    # Edge 124 / Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
)

_BIN_RE = re.compile(r"\b(\d{12})\b")
_AMOUNT_RE = re.compile(r"[\d\s.,]+")
_DATE_RE = re.compile(r"(\d{2})[.\-/](\d{2})[.\-/](\d{4})")


# ---------------------------------------------------------------------------
# Result containers
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class TenderRecord:
    """Normalized representation persisted to ``tenders``."""

    external_id: str
    title: str
    detail_url: str
    customer_name: str | None = None
    customer_bin_raw: str | None = None
    winner_bin_raw: str | None = None
    winner_name: str | None = None
    amount: Decimal | None = None
    currency: str = "KZT"
    status: str | None = None
    published_at: datetime | None = None
    deadline_at: datetime | None = None
    procurement_type: str | None = None
    documents: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "external_id": self.external_id,
            "title": self.title,
            "detail_url": self.detail_url,
            "customer_name": self.customer_name,
            "customer_bin_raw": self.customer_bin_raw,
            "winner_bin_raw": self.winner_bin_raw,
            "winner_name": self.winner_name,
            "amount": float(self.amount) if self.amount is not None else None,
            "currency": self.currency,
            "status": self.status,
            "published_at": (
                self.published_at.isoformat() if self.published_at else None
            ),
            "deadline_at": (
                self.deadline_at.isoformat() if self.deadline_at else None
            ),
            "procurement_type": self.procurement_type,
            "documents": list(self.documents),
            "raw": dict(self.raw),
        }


@dataclass(slots=True)
class CrawlResult:
    status: str  # "ok" | "blocked" | "error"
    pages_fetched: int = 0
    tenders: list[TenderRecord] = field(default_factory=list)
    reason: str | None = None
    fetched_pages: list[FetchedPage] = field(default_factory=list)


class BlockedError(RuntimeError):
    """Raised when the origin starts returning 403 — caller exits cleanly."""


# ---------------------------------------------------------------------------
# Spider
# ---------------------------------------------------------------------------


class KzGoszakupSpider(SimpleHttpSpider):
    """HTML-mirror spider for goszakup.gov.kz tender announcements."""

    source_key = "kz_goszakup"
    rate_limit_rpm = 60  # global 1 req/sec ceiling
    upload_to_r2 = True
    use_playwright = False
    use_proxy = True
    min_refresh_age_hours = 6

    # Per-source confidence (gov source) — surfaced in trust signals (C1 track).
    source_confidence = 0.95

    page_size: int = 50

    def __init__(
        self,
        *,
        max_pages: int = 20,
        request_delay: float = 1.0,
        jitter_ms: tuple[int, int] = (200, 800),
        rng: random.Random | None = None,
    ) -> None:
        super().__init__()
        self.max_pages = max_pages
        self.request_delay = request_delay
        self.jitter_ms = jitter_ms
        self._rng = rng or random.Random()  # noqa: S311 — non-crypto jitter only
        self._semaphore = asyncio.Semaphore(1)

    # ------------------------------------------------------------------ seeds
    async def make_seeds(self) -> list[str]:
        return [self._listing_url(1)]

    def _listing_url(self, page: int) -> str:
        return f"{BASE}{LISTING_PATH}?count={self.page_size}&page={page}"

    # -------------------------------------------------------- public entrypoint
    async def crawl(
        self,
        client: httpx.AsyncClient,
        *,
        since: datetime | None = None,
    ) -> CrawlResult:
        """Walk listing pages, fetch detail pages, return parsed tenders."""

        result = CrawlResult(status="ok")
        seen_detail_urls: set[str] = set()

        try:
            for page_no in range(1, self.max_pages + 1):
                listing_url = self._listing_url(page_no)
                page = await self._throttled_get(client, listing_url)
                result.fetched_pages.append(page)
                result.pages_fetched += 1

                listing_items = list(parse_listing(page.body))
                if not listing_items:
                    self.log.info(
                        "listing_empty",
                        page=page_no,
                        url=listing_url,
                    )
                    break

                for item in listing_items:
                    detail_url = item["detail_url"]
                    if not detail_url or detail_url in seen_detail_urls:
                        continue
                    seen_detail_urls.add(detail_url)

                    if since and item.get("published_at"):
                        if item["published_at"] < since:
                            continue

                    detail_page = await self._throttled_get(client, detail_url)
                    result.fetched_pages.append(detail_page)
                    result.pages_fetched += 1

                    detail = parse_detail(detail_page.body)
                    tender = merge_listing_and_detail(item, detail)
                    result.tenders.append(tender)

        except BlockedError as e:
            result.status = "blocked"
            result.reason = str(e)
            self.log.warning("kz_goszakup_blocked", reason=str(e))

        return result

    # ------------------------------------------------------------- fetch helper
    async def _throttled_get(
        self, client: httpx.AsyncClient, url: str
    ) -> FetchedPage:
        """One throttled GET. Handles 429 (Retry-After) and 403 (blocked)."""

        async with self._semaphore:
            await self._sleep_with_jitter()
            headers = self._build_headers()
            self.log.debug("kz_goszakup_get", url=url)
            resp = await client.get(url, headers=headers, timeout=30)

            if resp.status_code == 429:
                retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
                self.log.warning(
                    "kz_goszakup_429",
                    url=url,
                    retry_after=retry_after,
                )
                await asyncio.sleep(retry_after)
                resp = await client.get(url, headers=headers, timeout=30)

            if resp.status_code == 403:
                raise BlockedError(f"403 on {url}")

            body = resp.text
            page = FetchedPage(
                url=url,
                url_hash=url_hash(url),
                source=self.source_key,
                http_status=resp.status_code,
                content_type=resp.headers.get("content-type"),
                fetched_at=datetime.now(UTC),
                body=body,
            )

            if self.upload_to_r2 and resp.status_code == 200:
                try:
                    from app.crawlers.base import r2_key
                    from app.storage.r2 import r2

                    key = r2_key(self.source_key, url, page.fetched_at)
                    await r2.put_gz_html(key, body)
                    page.html_r2_key = key
                except Exception as e:
                    self.log.warning("r2_upload_failed", url=url, err=str(e))

            return page

    async def _sleep_with_jitter(self) -> None:
        lo, hi = self.jitter_ms
        jitter = self._rng.randint(lo, hi) / 1000.0
        await asyncio.sleep(self.request_delay + jitter)

    def _build_headers(self) -> dict[str, str]:
        ua = self._rng.choice(USER_AGENTS)
        return {
            "User-Agent": ua,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/webp,*/*;q=0.8"
            ),
            "Accept-Language": "ru,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
        }

    # ---------------------------------------------------- legacy parse interface
    async def parse(self, page: FetchedPage) -> AsyncIterator[dict[str, Any]]:
        """Compatibility with ``SimpleHttpSpider``: stream tender dicts."""
        if page.http_status != 200 or not page.body:
            return
        for item in parse_listing(page.body):
            yield item


# ---------------------------------------------------------------------------
# Parsers (pure functions — easy to unit test against HTML fixtures)
# ---------------------------------------------------------------------------


def parse_listing(html: str) -> list[dict[str, Any]]:
    """Parse one search-results page into a list of tender previews."""

    if not html:
        return []
    tree = HTMLParser(html)
    rows = tree.css("table.search-table tbody tr")
    if not rows:
        # Tolerant fallback for slight markup drift.
        rows = tree.css("tr.search-row")
    items: list[dict[str, Any]] = []
    for row in rows:
        link = row.css_first("td.t-number a") or row.css_first("a.t-link")
        if link is None:
            continue
        href = link.attributes.get("href") or ""
        external_id = _clean_text(link.text())
        if not external_id:
            continue

        title = _clean_text(_first_text(row, "td.t-name"))
        customer_cell_text = _first_text(row, "td.t-customer")
        amount_text = _first_text(row, "td.t-sum")
        status_text = _first_text(row, "td.t-status")
        deadline_text = _first_text(row, "td.t-deadline")
        published_text = _first_text(row, "td.t-published")

        customer_bin = _extract_bin(customer_cell_text)
        customer_name = _strip_bin(customer_cell_text)
        amount = _parse_amount(amount_text)

        items.append(
            {
                "external_id": external_id,
                "title": title,
                "detail_url": _absolute(href),
                "customer_name": customer_name or None,
                "customer_bin_raw": customer_bin,
                "amount": amount,
                "status": _clean_text(status_text) or None,
                "deadline_at": _parse_date(deadline_text),
                "published_at": _parse_date(published_text),
            }
        )
    return items


def parse_detail(html: str) -> dict[str, Any]:
    """Parse a tender detail page into the extra fields we care about."""

    if not html:
        return {}
    tree = HTMLParser(html)

    procurement = _first_text(tree, "[data-field=procurement]")
    if not procurement:
        procurement = _label_value(tree, "Способ закупки")

    published = _first_text(tree, "[data-field=published]")
    if not published:
        published = _label_value(tree, "Дата публикации")

    winner_bin_text = _first_text(tree, "[data-field=winner-bin]")
    winner_name = _first_text(tree, "[data-field=winner-name]")
    if not winner_bin_text:
        winner_bin_text = _label_value(tree, "БИН победителя")
    if not winner_name:
        winner_name = _label_value(tree, "Победитель")

    docs: list[str] = []
    for a in tree.css("a.doc-link"):
        href = a.attributes.get("href") or ""
        if href:
            docs.append(_absolute(href))

    return {
        "procurement_type": _clean_text(procurement) or None,
        "published_at": _parse_date(published),
        "winner_bin_raw": _extract_bin(winner_bin_text or ""),
        "winner_name": _clean_text(winner_name) or None,
        "documents": docs,
    }


def merge_listing_and_detail(
    listing: dict[str, Any], detail: dict[str, Any]
) -> TenderRecord:
    """Combine listing preview + detail page into one ``TenderRecord``."""

    return TenderRecord(
        external_id=listing["external_id"],
        title=listing.get("title") or "",
        detail_url=listing["detail_url"],
        customer_name=listing.get("customer_name"),
        customer_bin_raw=listing.get("customer_bin_raw"),
        winner_bin_raw=detail.get("winner_bin_raw"),
        winner_name=detail.get("winner_name"),
        amount=listing.get("amount"),
        currency="KZT",
        status=listing.get("status"),
        published_at=detail.get("published_at") or listing.get("published_at"),
        deadline_at=listing.get("deadline_at"),
        procurement_type=detail.get("procurement_type"),
        documents=list(detail.get("documents") or []),
        raw={"listing": _jsonable(listing), "detail": _jsonable(detail)},
    )


# ---------------------------------------------------------------------------
# Internals — text helpers
# ---------------------------------------------------------------------------


def _absolute(href: str) -> str:
    if not href:
        return ""
    if href.startswith("http"):
        return href
    if href.startswith("//"):
        return f"https:{href}"
    if not href.startswith("/"):
        href = "/" + href
    return f"{BASE}{href}"


def _first_text(root: Any, selector: str) -> str:
    node = root.css_first(selector)
    if node is None:
        return ""
    return _clean_text(node.text())


def _clean_text(text: str | None) -> str:
    if text is None:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _extract_bin(text: str) -> str | None:
    m = _BIN_RE.search(text or "")
    return m.group(1) if m else None


def _strip_bin(text: str) -> str:
    if not text:
        return ""
    return _clean_text(_BIN_RE.sub("", text))


def _parse_amount(text: str) -> Decimal | None:
    if not text:
        return None
    m = _AMOUNT_RE.search(text)
    if not m:
        return None
    raw = m.group(0)
    cleaned = raw.replace(" ", "").replace(" ", "").replace(",", ".")  # noqa: RUF001 — NBSP is intentional (thousands sep)
    # If multiple dots remain (thousands separator), keep only the last.
    if cleaned.count(".") > 1:
        head, _, tail = cleaned.rpartition(".")
        cleaned = head.replace(".", "") + "." + tail
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def _parse_date(text: str | None) -> datetime | None:
    if not text:
        return None
    m = _DATE_RE.search(text)
    if not m:
        return None
    day, month, year = m.groups()
    try:
        return datetime(int(year), int(month), int(day), tzinfo=UTC)
    except ValueError:
        return None


def _label_value(tree: HTMLParser, label: str) -> str:
    """Find a definition-list style ``<dt>label</dt><dd>value</dd>`` pair."""
    label_l = label.lower()
    for dt in tree.css("dt"):
        if _clean_text(dt.text()).lower().startswith(label_l):
            sibling = dt.next
            while sibling is not None and sibling.tag != "dd":
                sibling = sibling.next
            if sibling is not None:
                return _clean_text(sibling.text())
    # Fallback: any <th> + <td> sibling.
    for th in tree.css("th"):
        if _clean_text(th.text()).lower().startswith(label_l):
            sibling = th.next
            while sibling is not None and sibling.tag != "td":
                sibling = sibling.next
            if sibling is not None:
                return _clean_text(sibling.text())
    return ""


def _parse_retry_after(value: str | None) -> float:
    if not value:
        return 30.0
    try:
        return max(1.0, float(value))
    except ValueError:
        return 30.0


def _jsonable(obj: dict[str, Any]) -> dict[str, Any]:
    """Best-effort: convert datetimes / Decimals so the dict is JSON-safe."""
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out
