"""Arq worker entrypoint.

Run:
    arq app.workers.main.WorkerSettings
"""

from __future__ import annotations

from arq import cron
from arq.connections import RedisSettings

from app.config import settings
from app.core.logging import configure_logging
from app.workers.digest import digest_runner
from app.workers.tasks.alerts import evaluate_alerts, release_pending_alerts
from app.workers.tasks.crawl import crawl_kz_goszakup_daily, crawl_source
from app.workers.tasks.discovery import run_discovery
from app.workers.tasks.egov_enrich import egov_enrich
from app.workers.tasks.enrich import enrich_kz_batch
from app.workers.tasks.events import flush_outbox
from app.workers.tasks.extraction import process_extraction
from app.workers.tasks.kz_stat_refresh import kz_stat_refresh
from app.workers.tasks.region_risk import refresh_region_risk_index


async def startup(ctx: dict) -> None:
    configure_logging()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)

    functions = [
        crawl_source,
        crawl_kz_goszakup_daily,
        run_discovery,
        process_extraction,
        evaluate_alerts,
        release_pending_alerts,
        flush_outbox,
        enrich_kz_batch,
        egov_enrich,
        digest_runner,
        kz_stat_refresh,
        refresh_region_risk_index,
    ]

    cron_jobs = [
        cron(run_discovery, hour={9, 21}, minute=0),       # 2× daily
        cron(evaluate_alerts, minute={0, 15, 30, 45}),     # every 15 min
        cron(release_pending_alerts, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
        cron(flush_outbox, second={0, 30}),                # every 30 sec
        cron(enrich_kz_batch, minute={5, 35}),             # every 30 min: enrich 25 KZ companies
        cron(digest_runner, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
        # kz_goszakup HTML mirror — 04:00 KZ (UTC+5) → 23:00 UTC the day before.
        cron(crawl_kz_goszakup_daily, hour={23}, minute={0}),
        # kz_stat refresh — Wed 03:00 KZ time (UTC+5) → 22:00 UTC Tue
        cron(kz_stat_refresh, weekday="tues", hour={22}, minute=0),
        cron(refresh_region_risk_index, hour={3}, minute=0),  # nightly @ 03:00 UTC
    ]

    on_startup = startup
    keep_result_seconds = 3600
    max_jobs = 10
