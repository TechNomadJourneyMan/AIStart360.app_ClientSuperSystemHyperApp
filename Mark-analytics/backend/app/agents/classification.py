"""ClassificationAgent — embed + tag + industry classification."""

from __future__ import annotations

from app.agents.base import AgentJob, AgentResult, BaseAgent
from app.ai import ChatMessage, GenerateRequest, Task, gateway
from app.ai.prompts import render


class ClassificationAgent(BaseAgent):
    name = "classification"
    task_topic = "events:classification"

    async def handle(self, job: AgentJob) -> AgentResult:
        text = job.payload.get("text", "")
        if not text:
            return AgentResult(ok=False, error="empty text")

        # 1. Industry classification
        prompt = render("classify_industry", content=text[:4000])
        cls_resp = await gateway.generate(
            GenerateRequest(
                task=Task.CLASSIFY_INDUSTRY,
                messages=[ChatMessage(role="user", content=prompt)],
                agent=self.name, request_id=job.id,
            )
        )
        industry_code = cls_resp.text.strip()

        # 2. Embedding (local fastembed)
        embed_resp = await gateway.embed([text[:4000]], task=Task.EMBED_COMPANY_PROFILE,
                                          request_id=job.id)

        return AgentResult(
            ok=True,
            output={
                "industry_code": industry_code,
                "embedding_dim": len(embed_resp.vectors[0]) if embed_resp.vectors else 0,
                "embedding": embed_resp.vectors[0] if embed_resp.vectors else None,
                "cost_usd": cls_resp.usage.cost_usd,
            },
        )
