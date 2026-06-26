"""Arq task: run DiscoveryAgent for one or all sources."""

from __future__ import annotations

from typing import Any

from app.agents.base import AgentJob
from app.agents.discovery import DiscoveryAgent


async def run_discovery(ctx: dict[str, Any], source_key: str | None = None) -> dict[str, Any]:
    agent = DiscoveryAgent()
    job = AgentJob(
        id=str(ctx.get("job_id", "manual")),
        idempotency_key=f"discovery:{source_key or 'all'}",
        payload={"source_key": source_key},
    )
    result = await agent.run(job)
    return {"ok": result.ok, "output": result.output}
