"""SummarizationAgent — on-demand summaries (company profile, news digest)."""

from __future__ import annotations

from app.agents.base import AgentJob, AgentResult, BaseAgent
from app.ai import ChatMessage, GenerateRequest, Task, gateway
from app.ai.prompts import render


class SummarizationAgent(BaseAgent):
    name = "summarization"
    task_topic = "events:summarization"

    async def handle(self, job: AgentJob) -> AgentResult:
        kind = job.payload.get("kind", "news")
        content = job.payload.get("content", "")
        prompt = render("summarize_news", content=content[:8000])
        resp = await gateway.generate(
            GenerateRequest(
                task=Task.SUMMARIZE_NEWS if kind == "news" else Task.SUMMARIZE_REVIEWS,
                messages=[ChatMessage(role="user", content=prompt)],
                agent=self.name, request_id=job.id,
            )
        )
        return AgentResult(
            ok=True,
            output={
                "summary": resp.text,
                "cost_usd": resp.usage.cost_usd,
                "cache_hit": resp.usage.cache_hit,
            },
        )
