"""Local embeddings via fastembed (CPU, BGE-M3 default). Free, offline.

Lazy-loads the model on first use (~500MB download on first call).
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from app.ai.providers.base import AIProvider, ProviderError
from app.ai.types import EmbedRequest, EmbedResponse, GenerateRequest, GenerateResponse, Provider, Usage
from app.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from fastembed import TextEmbedding  # type: ignore[import-untyped]

logger = get_logger("ai.local_embed")


class LocalEmbedProvider(AIProvider):
    provider = Provider.LOCAL
    _model: "TextEmbedding | None" = None
    _lock = asyncio.Lock()

    async def _get_model(self) -> "TextEmbedding":
        if self._model is None:
            async with self._lock:
                if self._model is None:
                    try:
                        from fastembed import TextEmbedding
                    except ImportError as e:
                        raise ProviderError("fastembed not installed; pip install fastembed") from e
                    logger.info("loading_local_embed_model", model=settings.EMBED_MODEL)
                    self.__class__._model = TextEmbedding(
                        model_name=settings.EMBED_MODEL,
                        cache_dir=settings.EMBED_CACHE_DIR,
                    )
        return self.__class__._model  # type: ignore[return-value]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Public helper for use in semantic-cache (avoids round-tripping through gateway)."""
        if not texts:
            return []
        model = await self._get_model()
        # fastembed is sync; run in executor
        loop = asyncio.get_running_loop()
        vecs = await loop.run_in_executor(None, lambda: list(model.embed(texts)))
        return [v.tolist() for v in vecs]

    async def chat(self, model: str, req: GenerateRequest) -> GenerateResponse:  # pragma: no cover
        raise NotImplementedError("LocalEmbedProvider does not support chat")

    async def embed(self, model: str, req: EmbedRequest) -> EmbedResponse:
        started = time.perf_counter()
        vecs = await self.embed_texts(req.texts)
        latency_ms = int((time.perf_counter() - started) * 1000)
        return EmbedResponse(
            vectors=vecs,
            model_used=model,
            provider=Provider.LOCAL,
            usage=Usage(latency_ms=latency_ms),
        )
