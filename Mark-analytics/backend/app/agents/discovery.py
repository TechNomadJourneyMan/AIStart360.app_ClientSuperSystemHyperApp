"""DiscoveryAgent — finds candidate URLs/entities and queues crawl jobs."""

from __future__ import annotations

from app.agents.base import AgentJob, AgentResult, BaseAgent


class DiscoveryAgent(BaseAgent):
    name = "discovery"
    task_topic = "events:discovery"

    async def handle(self, job: AgentJob) -> AgentResult:
        """Job payload: {source_key, hint?}.

        Real impl: query the source's index/sitemap/listing API, emit one
        `CompanyDiscovered` per new external_id. Stub returns ok with empty events.
        """
        source = job.payload.get("source_key")
        self.log.info("discovery_run", source=source)
        return AgentResult(ok=True, output={"discovered": 0}, events=[])
