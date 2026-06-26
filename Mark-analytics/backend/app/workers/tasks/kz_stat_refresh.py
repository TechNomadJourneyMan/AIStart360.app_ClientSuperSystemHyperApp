"""Arq task: weekly refresh of the kz_stat BIN registry.

Cron: Wed 03:00 KZ time (UTC+5) → 22:00 UTC Tue (registered in
``app.workers.main``).

Schedules a 6h retry by enqueueing itself when the source is blocked.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import update

from app.core.logging import get_logger
from app.crawlers.spiders.kz_stat import (
    KzStatBlockedError,
    KzStatSchemaError,
    run_kz_stat_download,
)
from app.db.session import async_session_factory
from app.models.ingest_job import IngestJob

log = get_logger("workers.kz_stat_refresh")


async def _create_job_row() -> Any:
    async with async_session_factory() as session:
        job = IngestJob(source="kz_stat", kind="crawl", status="running")
        session.add(job)
        await session.commit()
        await session.refresh(job)
        return job.id


async def _finish_job_row(
    job_id: Any,
    *,
    status: str,
    items_processed: int = 0,
    items_added: int = 0,
    items_updated: int = 0,
    items_failed: int = 0,
    error: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    async with async_session_factory() as session:
        await session.execute(
            update(IngestJob)
            .where(IngestJob.id == job_id)
            .values(
                status=status,
                finished_at=datetime.now(UTC),
                items_processed=items_processed,
                items_added=items_added,
                items_updated=items_updated,
                items_failed=items_failed,
                error=error,
                payload=payload,
            )
        )
        await session.commit()


async def kz_stat_refresh(
    ctx: dict[str, Any], dataset_url: str | None = None,
) -> dict[str, Any]:
    """Run a full kz_stat refresh. Records start/finish in ``ingest_jobs``.

    Returns a dict with ``status`` ∈ {"ok", "partial", "blocked", "failed"}.
    """
    job_id = await _create_job_row()
    try:
        result = await run_kz_stat_download(dataset_url=dataset_url)
    except KzStatBlockedError as e:
        log.warning("kz_stat_blocked", err=str(e))
        await _finish_job_row(
            job_id, status="failed", error=f"blocked: {e}",
            payload={"retry_in_hours": 6},
        )
        # Schedule retry via Arq if a redis pool is available.
        redis = ctx.get("redis")
        if redis is not None:
            try:
                await redis.enqueue_job(
                    "kz_stat_refresh", _defer_by=6 * 3600,
                )
            except Exception:
                log.warning("kz_stat_retry_enqueue_failed")
        return {"status": "blocked", "error": str(e)}
    except KzStatSchemaError as e:
        log.error("kz_stat_schema_error", err=str(e))
        await _finish_job_row(
            job_id, status="failed", error=f"schema_error: {e}",
        )
        return {"status": "failed", "error": str(e)}
    except Exception as e:
        log.exception("kz_stat_unexpected_failure")
        await _finish_job_row(job_id, status="failed", error=str(e))
        return {"status": "failed", "error": str(e)}

    status = "partial" if result.rows_failed else "ok"
    await _finish_job_row(
        job_id,
        status=status,
        items_processed=result.rows_processed,
        items_added=result.rows_inserted,
        items_updated=result.rows_updated,
        items_failed=result.rows_failed,
        payload=result.as_dict(),
    )
    return {"status": status, **result.as_dict()}
