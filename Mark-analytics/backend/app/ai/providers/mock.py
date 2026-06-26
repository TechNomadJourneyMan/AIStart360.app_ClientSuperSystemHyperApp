"""MockProvider — deterministic, no network. Used in unit tests and dev when keys are missing."""

from __future__ import annotations

import hashlib
import json

from app.ai.providers.base import AIProvider
from app.ai.types import (
    EmbedRequest,
    EmbedResponse,
    GenerateRequest,
    GenerateResponse,
    Provider,
    Usage,
)


class MockProvider(AIProvider):
    provider = Provider.MOCK

    async def chat(self, model: str, req: GenerateRequest) -> GenerateResponse:
        # Deterministic text based on hash of inputs.
        last = req.messages[-1].content if req.messages else ""
        digest = hashlib.sha1(last.encode()).hexdigest()[:8]
        text = f"[mock:{model}:{digest}] echo: {last[:80]}"

        if req.json_schema is not None:
            # Return a minimal JSON that matches a few common schemas.
            text = json.dumps({"name": "MockCompany", "bin": "000000000000", "industry": "62.01"})

        return GenerateResponse(
            text=text,
            model_used=model,
            provider=Provider.MOCK,
            finish_reason="stop",
            usage=Usage(
                tokens_in=len(last) // 4,
                tokens_out=len(text) // 4,
                cost_usd=0.0,
                latency_ms=1,
                cache_hit=False,
                cache_type="none",
            ),
        )

    async def embed(self, model: str, req: EmbedRequest) -> EmbedResponse:
        # 1024-dim zero vectors — enough for shape tests.
        return EmbedResponse(
            vectors=[[0.0] * 1024 for _ in req.texts],
            model_used=model,
            provider=Provider.MOCK,
            usage=Usage(latency_ms=1),
        )
