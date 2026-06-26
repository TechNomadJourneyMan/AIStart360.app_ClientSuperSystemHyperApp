"""TrendAgent — periodic SQL aggregations into snapshot tables.

For MVP: just runs the aggregation queries on demand. Materialized views and
scheduled refresh come in Phase 2.
"""

from __future__ import annotations

from app.agents.base import AgentJob, AgentResult, BaseAgent


class TrendAgent(BaseAgent):
    name = "trend"
    task_topic = "events:trend"

    async def handle(self, job: AgentJob) -> AgentResult:
        # Stub — real impl runs SQL aggregations (CREATE MATERIALIZED VIEW + REFRESH).
        kind = job.payload.get("kind", "industry_growth")
        self.log.info("trend_recompute", kind=kind)
        return AgentResult(ok=True, output={"refreshed": kind})
