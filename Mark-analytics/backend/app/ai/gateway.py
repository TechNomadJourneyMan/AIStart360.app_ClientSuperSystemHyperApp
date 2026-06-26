"""AI Gateway facade. Concrete provider routing is implemented in app.ai.router.

Public API:
    gateway.generate(req) -> GenerateResponse
    gateway.generate_structured(req, schema) -> GenerateResponse(parsed=...)
    gateway.embed(texts, task) -> EmbedResponse

Implementation details (cache + router + providers) live in sibling modules
and are filled in by the ai-engineer agent.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypeVar

from pydantic import BaseModel

from app.ai.types import (
    EmbedRequest,
    EmbedResponse,
    GenerateRequest,
    GenerateResponse,
    Task,
)

if TYPE_CHECKING:
    from collections.abc import Sequence


T = TypeVar("T", bound=BaseModel)


class AIGateway:
    """Singleton facade. Real wiring inside router.run()."""

    async def generate(self, req: GenerateRequest) -> GenerateResponse:
        from app.ai.router import run

        return await run(req)

    async def generate_structured(
        self, req: GenerateRequest, *, schema: type[T]
    ) -> GenerateResponse:
        req.json_schema = schema.model_json_schema()
        resp = await self.generate(req)
        if resp.text:
            try:
                resp.parsed = schema.model_validate_json(resp.text)
            except Exception:  # noqa: BLE001
                # Provider may return content already parsed; fallback to text only.
                pass
        return resp

    async def embed(
        self,
        texts: Sequence[str],
        task: Task = Task.EMBED_COMPANY_PROFILE,
        *,
        request_id: str | None = None,
    ) -> EmbedResponse:
        from app.ai.router import run_embed

        return await run_embed(EmbedRequest(texts=list(texts), task=task, request_id=request_id))


gateway = AIGateway()
