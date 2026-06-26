"""CrawlAgent — thin orchestration around `app.crawlers.runner`."""

from __future__ import annotations

from app.agents.base import AgentJob, AgentResult, BaseAgent


class CrawlAgent(BaseAgent):
    name = "crawl"
    task_topic = "events:crawl"

    async def handle(self, job: AgentJob) -> AgentResult:
        """Job payload: {source_key, seeds: [url], job_id}."""
        from app.crawlers.runner import run_spider

        source = job.payload["source_key"]
        seeds = job.payload.get("seeds", [])
        pages = await run_spider(source_key=source, seeds=seeds, job_id=job.id)
        return AgentResult(ok=True, output={"pages_fetched": pages}, events=[])
