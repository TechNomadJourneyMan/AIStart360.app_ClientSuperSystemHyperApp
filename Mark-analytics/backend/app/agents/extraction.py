"""ExtractionAgent — turn raw HTML into structured Company/Tender entities.

Strategy:
  1. Rule-based parser if `source_key` has one registered.
  2. LLM extraction fallback via `gateway.generate_structured(Task.EXTRACT_COMPANY)`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.agents.base import AgentJob, AgentResult, BaseAgent
from app.ai import ChatMessage, GenerateRequest, Task, gateway
from app.ai.prompts import render


class CompanyExtraction(BaseModel):
    name: str | None = None
    legal_form: str | None = None
    bin: str | None = None
    inn: str | None = None
    country: str | None = None
    industry_code: str | None = None
    industry_label: str | None = None
    registered_at: str | None = None
    status: str | None = None
    address: str | None = None
    website: str | None = None
    email: str | None = None
    phone: str | None = None
    director_name: str | None = None
    description: str | None = None
    confidence: float | None = None


# Source → optional rule parser registry. Crawl-engineer adds here.
RULE_PARSERS: dict[str, Any] = {}


class ExtractionAgent(BaseAgent):
    name = "extraction"
    task_topic = "events:extraction"

    async def handle(self, job: AgentJob) -> AgentResult:
        source = job.payload.get("source_key", "unknown")
        content = job.payload.get("content", "")
        url = job.payload.get("url")

        # Try rule-based first
        rule = RULE_PARSERS.get(source)
        if rule is not None:
            try:
                rule_result = rule(content)
                if rule_result and rule_result.get("name"):
                    return AgentResult(
                        ok=True,
                        output={"extractor": "rule", "extracted": rule_result},
                    )
            except Exception as e:  # noqa: BLE001
                self.log.warning("rule_parser_failed", source=source, err=str(e))

        # Fall back to LLM
        prompt = render("extract_company", source=source, url=url or "unknown", content=content[:8000])
        resp = await gateway.generate_structured(
            GenerateRequest(
                task=Task.EXTRACT_COMPANY,
                messages=[ChatMessage(role="user", content=prompt)],
                agent=self.name,
                request_id=job.id,
            ),
            schema=CompanyExtraction,
        )
        extracted: CompanyExtraction | None = resp.parsed
        if extracted is None:
            return AgentResult(ok=False, error="LLM returned no parsable extraction")
        return AgentResult(
            ok=True,
            output={
                "extractor": f"llm:{resp.model_used}",
                "extracted": extracted.model_dump(exclude_none=True),
                "cost_usd": resp.usage.cost_usd,
                "tokens_in": resp.usage.tokens_in,
                "tokens_out": resp.usage.tokens_out,
                "cache_hit": resp.usage.cache_hit,
            },
        )
