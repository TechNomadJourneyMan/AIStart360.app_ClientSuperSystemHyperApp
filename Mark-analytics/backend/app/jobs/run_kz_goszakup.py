"""CLI: ``python -m app.jobs.run_kz_goszakup --max-pages N --since YYYY-MM-DD``.

Runs the kz_goszakup HTML mirror spider once, end-to-end:
- walk listing pages (capped by ``--max-pages``)
- fetch detail pages
- persist pages + upsert tenders
- print a one-line summary to stdout

The default ``--max-pages`` is 20 (about 1000 tenders at page_size=50) to
keep CLI runs safe; the cron uses the same default. Tweak the value when
back-filling.

Exits with code:
- ``0`` on success
- ``2`` when the spider reports ``status='blocked'`` (dispatcher should retry)
- ``1`` on any other failure
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime

import httpx

from app.core.logging import configure_logging, get_logger
from app.crawlers.spiders.kz_goszakup import KzGoszakupSpider
from app.crawlers.spiders.kz_goszakup_persist import (
    persist_pages,
    persist_tenders,
)
from app.db.session import async_session_factory

log = get_logger("jobs.run_kz_goszakup")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="run_kz_goszakup")
    parser.add_argument(
        "--max-pages",
        type=int,
        default=20,
        help="Maximum number of listing pages to walk (default 20).",
    )
    parser.add_argument(
        "--since",
        type=str,
        default=None,
        help=(
            "Only ingest tenders published on/after this date "
            "(YYYY-MM-DD). Default: no lower bound (last 2 years honoured by "
            "natural pagination)."
        ),
    )
    return parser.parse_args(argv)


def _parse_since(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as e:
        raise SystemExit(f"--since: bad date '{value}' ({e})") from e


async def run(*, max_pages: int, since: datetime | None) -> dict[str, int | str]:
    spider = KzGoszakupSpider(max_pages=max_pages)
    async with httpx.AsyncClient(follow_redirects=True) as client:
        result = await spider.crawl(client, since=since)

    summary: dict[str, int | str] = {
        "status": result.status,
        "pages_fetched": result.pages_fetched,
        "tenders": len(result.tenders),
    }
    if result.reason:
        summary["reason"] = result.reason

    if result.status == "blocked":
        log.warning("kz_goszakup_blocked_exit", **summary)
        return summary

    async with async_session_factory() as session:
        async with session.begin():
            inserted_pages = await persist_pages(session, result.fetched_pages)
            counters = await persist_tenders(session, result.tenders)
        summary["pages_inserted"] = inserted_pages
        summary.update({f"tenders_{k}": v for k, v in counters.items()})

    log.info("kz_goszakup_done", **summary)
    return summary


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    args = _parse_args(argv)
    since = _parse_since(args.since)
    summary = asyncio.run(run(max_pages=args.max_pages, since=since))
    print(summary)
    status = summary.get("status")
    if status == "blocked":
        return 2
    if status == "ok":
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["main", "run"]
