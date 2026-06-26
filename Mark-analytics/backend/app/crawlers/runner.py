"""Crawl runner — invoked from Arq worker tasks.

For now uses our async SimpleHttpSpider directly. Full Scrapy spiders (with
JS rendering via Playwright) will be invoked via subprocess in Phase 2 to
keep the asyncio loop clean.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger
from app.crawlers.spiders import SPIDER_REGISTRY

log = get_logger("crawler.runner")


async def run_spider(*, source_key: str, seeds: list[str] | None = None, job_id: str | None = None) -> int:
    """Run a spider end-to-end. Returns number of pages successfully fetched."""
    cls = SPIDER_REGISTRY.get(source_key)
    if cls is None:
        log.warning("spider_not_found", source_key=source_key)
        return 0
    spider = cls()
    urls = seeds or await spider.make_seeds()
    fetched = 0
    extracted: list[dict[str, Any]] = []
    async with httpx.AsyncClient() as client:
        for url in urls:
            try:
                page = await spider.fetch(client, url)
                fetched += 1
                async for item in spider.parse(page):
                    extracted.append(item)
            except Exception as e:  # noqa: BLE001
                log.warning("page_failed", url=url, err=str(e))

    log.info("crawl_done", source=source_key, pages=fetched,
             extracted=len(extracted), job_id=job_id)
    return fetched
