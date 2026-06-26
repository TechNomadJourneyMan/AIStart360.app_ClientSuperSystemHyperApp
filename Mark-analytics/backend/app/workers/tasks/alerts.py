"""Arq tasks: evaluate alert rules + release quiet-hours-deferred alerts."""

from __future__ import annotations

from typing import Any

from app.agents.alert import AlertAgent
from app.agents.base import AgentJob
from app.db.session import async_session_factory
from app.notifications.dispatcher import release_due_pending


async def evaluate_alerts(ctx: dict[str, Any]) -> dict[str, Any]:
    agent = AlertAgent()
    job = AgentJob(
        id=str(ctx.get("job_id", "cron")),
        idempotency_key="alerts:cron",
        payload={},
    )
    result = await agent.run(job)
    return {"ok": result.ok, "output": result.output}


async def release_pending_alerts(ctx: dict[str, Any]) -> dict[str, Any]:
    """Drain ``pending_alerts`` rows whose ``scheduled_for`` has elapsed.

    Scheduled by :class:`app.workers.main.WorkerSettings` every 5 minutes.
    """
    async with async_session_factory() as session:
        results = await release_due_pending(session)
        await session.commit()
    delivered = sum(1 for _, r in results if r.ok and not r.meta.get("deferred"))
    return {"picked": len(results), "delivered": delivered}
