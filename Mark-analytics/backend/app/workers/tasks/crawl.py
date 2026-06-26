"""Arq task: run a spider for a source."""

from __future__ import annotations

from datetime import UTC
from typing import Any

from app.core.logging import get_logger
from app.crawlers.runner import run_spider

log = get_logger("workers.crawl")


async def crawl_source(
    ctx: dict[str, Any], source_key: str, seeds: list[str] | None = None,
) -> dict[str, Any]:
    pages = await run_spider(source_key=source_key, seeds=seeds, job_id=ctx.get("job_id"))
    return {"pages": pages, "source_key": source_key}


async def crawl_kz_goszakup_daily(
    ctx: dict[str, Any],
    *,
    max_pages: int = 20,
    since: str | None = None,
) -> dict[str, Any]:
    """Arq cron entrypoint for the daily kz_goszakup HTML mirror run.

    Wraps ``app.jobs.run_kz_goszakup.run`` so the Arq scheduler can call it
    without touching argparse. Scheduled at 04:00 KZ (UTC+5 → 23:00 UTC) in
    ``app/workers/main.py``.
    """

    from datetime import datetime

    from app.jobs.run_kz_goszakup import run as run_job

    since_dt: datetime | None = None
    if since:
        since_dt = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=UTC)

    summary = await run_job(max_pages=max_pages, since=since_dt)
    log.info("kz_goszakup_cron_done", **summary)
    return summary
