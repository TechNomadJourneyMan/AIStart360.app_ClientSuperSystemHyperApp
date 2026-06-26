"""Base spider contract. Concrete spiders extend BaseSpider.

For Scrapy users: this is a thin layer above scrapy.Spider that adds R2 upload
and `pages` table persistence helpers. We expose an HTTP-only (no Scrapy framework)
alternative `SimpleHttpSpider` for sources with a clean REST/JSON API — avoids
Scrapy reactor complexity.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, AsyncIterator

import httpx

from app.core.logging import get_logger
from app.storage.r2 import r2


@dataclass(slots=True)
class FetchedPage:
    url: str
    url_hash: str
    source: str
    http_status: int
    content_type: str | None
    fetched_at: datetime
    body: str
    html_r2_key: str | None = None


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def r2_key(source: str, url: str, dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return f"raw/{source}/{dt:%Y/%m/%d}/{url_hash(url)}.html.gz"


class SimpleHttpSpider(ABC):
    """Async HTTP spider. Subclass and implement `make_seeds` + `parse`.

    Use this for clean REST/JSON sources where Scrapy is overkill.
    """

    source_key: str
    rate_limit_rpm: int = 30
    upload_to_r2: bool = True
    headers: dict[str, str] = {"User-Agent": "Mozilla/5.0 (Mark Analytics crawler)"}

    def __init__(self) -> None:
        self.log = get_logger(f"crawler.{self.source_key}")

    @abstractmethod
    async def make_seeds(self) -> list[str]:
        ...

    @abstractmethod
    async def parse(self, page: FetchedPage) -> AsyncIterator[dict[str, Any]]:
        """Yield extracted records OR follow URLs as dicts {follow: url}."""
        if False:
            yield {}

    async def fetch(self, client: httpx.AsyncClient, url: str) -> FetchedPage:
        resp = await client.get(url, headers=self.headers, timeout=30)
        body = resp.text
        page = FetchedPage(
            url=url, url_hash=url_hash(url), source=self.source_key,
            http_status=resp.status_code,
            content_type=resp.headers.get("content-type"),
            fetched_at=datetime.now(timezone.utc), body=body,
        )
        if self.upload_to_r2 and resp.status_code == 200:
            key = r2_key(self.source_key, url, page.fetched_at)
            try:
                await r2.put_gz_html(key, body)
                page.html_r2_key = key
            except Exception as e:  # noqa: BLE001
                self.log.warning("r2_upload_failed", url=url, err=str(e))
        return page
