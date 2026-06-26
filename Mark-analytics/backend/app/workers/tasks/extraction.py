"""Arq task: process extraction for a page."""

from __future__ import annotations

from typing import Any

from app.agents.base import AgentJob
from app.agents.extraction import ExtractionAgent


async def process_extraction(
    ctx: dict[str, Any], page_id: str, source_key: str, content: str, url: str | None = None,
) -> dict[str, Any]:
    agent = ExtractionAgent()
    job = AgentJob(
        id=str(ctx.get("job_id", "manual")),
        idempotency_key=f"extract:{page_id}",
        payload={"source_key": source_key, "content": content, "url": url},
    )
    result = await agent.run(job)
    return {"ok": result.ok, "output": result.output, "error": result.error}
