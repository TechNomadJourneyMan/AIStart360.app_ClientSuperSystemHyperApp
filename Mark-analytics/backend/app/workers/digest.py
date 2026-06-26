"""Arq job: tick the digest scheduler every 5 minutes.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track B

The job is intentionally idempotent — `services.digest.run_subscription`
holds an in-process lock so two simultaneous workers can't double-fire
the same subscription, and the DB column `last_run_at` is the durable
guard for missed runs.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.db.session import async_session_factory
from app.services.digest import compute_due_subscriptions, run_subscription

logger = get_logger("workers.digest")


async def digest_runner(ctx: dict[str, Any]) -> dict[str, Any]:
    """Cron entry point — wired in `app.workers.main` at 5-minute interval."""
    now = datetime.now(UTC)
    ok = 0
    empty = 0
    errors = 0

    async with async_session_factory() as session:
        try:
            due = await compute_due_subscriptions(session, now)
        except Exception:
            logger.exception("digest_runner_query_failed")
            return {"ok": 0, "empty": 0, "errors": 1, "due": 0}

        for sub in due:
            try:
                run = await run_subscription(session, sub, now=now)
                session.add(run)
                # `last_run_at` is mutated on the subscription by the service.
                session.add(sub)
                await session.commit()
                if run.status == "success":
                    ok += 1
                elif run.status == "empty":
                    empty += 1
                else:
                    errors += 1
            except Exception:
                await session.rollback()
                errors += 1
                logger.exception(
                    "digest_runner_subscription_failed",
                    subscription_id=str(sub.id),
                )

    logger.info(
        "digest_runner_tick",
        due=len(due),
        ok=ok,
        empty=empty,
        errors=errors,
    )
    return {"due": len(due), "ok": ok, "empty": empty, "errors": errors}
