"""kompra.kz spider — uses Firecrawl to bypass anti-bot.

kompra.kz is a commercial KZ company registry. Their site uses Cloudflare-style
challenge + JS-rendered content. Direct httpx returns either 403 or a stub page.

Strategy:
  1. Use Firecrawl `/v1/map` to discover company URLs on kompra.kz under /company/
  2. For each URL — Firecrawl `/v1/scrape` with markdown + structured extraction
  3. Upsert by BIN

Rate-limit handled by Firecrawl's queue. We additionally cap concurrency to 3.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from app.core.logging import get_logger
from app.crawlers.firecrawl_client import (
    COMPANY_EXTRACT_SCHEMA,
    FirecrawlNotConfigured,
    extract_company_from_url,
    firecrawl,
)

log = get_logger("crawler.kz_kompra")

BASE = "https://kompra.kz"


class KzKompraFirecrawlSpider:
    """Pseudo-spider: uses Firecrawl instead of httpx + scrapy."""

    source_key = "kz_kompra"
    rate_limit_rpm = 30
    use_firecrawl = True

    async def discover(self, *, limit: int = 50, search: str | None = None) -> list[str]:
        """Find company page URLs via Firecrawl /v1/map."""
        try:
            urls = await firecrawl.map_urls(BASE, limit=limit, search=search)
        except FirecrawlNotConfigured as e:
            log.warning("firecrawl_not_configured", err=str(e))
            return []
        except Exception as e:  # noqa: BLE001
            log.warning("kompra_discover_failed", err=str(e))
            return []
        # Filter to per-company pages. kompra.kz uses /organization/<BIN>
        company_urls = [
            u for u in urls
            if "/organization/" in u or "/company/" in u
        ]
        # If map returned only homepage/sitemap — try the canonical organization path discovery
        if not company_urls:
            company_urls = await self._discover_via_sitemap(limit)
        return company_urls[:limit]

    async def _discover_via_sitemap(self, limit: int) -> list[str]:
        """Last-resort: scrape one sitemap to extract organization URLs."""
        try:
            res = await firecrawl.scrape(
                f"{BASE}/sitemaps/sitemap_1.xml", formats=["html"], only_main=False
            )
            if not res.success or not res.html:
                return []
            import re
            urls = re.findall(r"<loc>(https://kompra\.kz/organization/\d+)</loc>", res.html)
            return urls[:limit]
        except Exception as e:  # noqa: BLE001
            log.warning("sitemap_discover_failed", err=str(e))
            return []

    async def fetch_one(self, url: str) -> dict[str, Any] | None:
        """Scrape + structured extraction in one call."""
        return await extract_company_from_url(url)

    async def crawl(self, *, limit: int = 20, concurrency: int = 3) -> AsyncIterator[dict[str, Any]]:
        """Discover + extract — yields normalized company dicts."""
        urls = await self.discover(limit=limit)
        log.info("kompra_discovered", count=len(urls))
        sem = asyncio.Semaphore(concurrency)

        async def _one(u: str) -> dict[str, Any] | None:
            async with sem:
                try:
                    return await self.fetch_one(u)
                except Exception as e:  # noqa: BLE001
                    log.warning("kompra_scrape_failed", url=u, err=str(e))
                    return None

        for coro in asyncio.as_completed([_one(u) for u in urls]):
            row = await coro
            if row and row.get("name"):
                row["data_source"] = "kompra.kz"
                row["source_confidence"] = 0.85
                row["country"] = "KZ"
                yield row
