"""Arq task: run EnrichmentAgent on a batch of stale companies."""

from __future__ import annotations

from typing import Any

from app.agents.base import AgentJob
from app.agents.enrichment import EnrichmentAgent


async def enrich_kz_batch(
    ctx: dict[str, Any], limit: int = 25, bin_code: str | None = None,
) -> dict[str, Any]:
    """Enrich up to `limit` KZ companies missing stat.gov.kz fields.

    If `bin_code` is set — enrich that single company.
    """
    agent = EnrichmentAgent()
    job = AgentJob(
        id=str(ctx.get("job_id", "manual")),
        idempotency_key=f"enrich:{bin_code or 'batch'}:{limit}",
        payload={"source": "kz_stat_gov", "limit": limit, "bin": bin_code},
    )
    result = await agent.run(job)
    return {"ok": result.ok, "output": result.output, "error": result.error}
