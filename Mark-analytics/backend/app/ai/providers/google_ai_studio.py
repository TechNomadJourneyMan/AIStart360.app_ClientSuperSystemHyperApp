"""Google AI Studio provider — Gemini chat + embeddings via REST."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.ai.providers.base import (
    AIProvider,
    Provider5xx,
    ProviderError,
    ProviderRateLimit,
    ProviderTimeout,
)
from app.ai.registry import MODEL_CATALOG
from app.ai.types import (
    EmbedRequest,
    EmbedResponse,
    GenerateRequest,
    GenerateResponse,
    Provider,
    Usage,
)
from app.config import settings
from app.core.logging import get_logger

logger = get_logger("ai.google")

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GoogleAIStudioProvider(AIProvider):
    provider = Provider.GOOGLE_AI_STUDIO

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=BASE_URL,
                timeout=httpx.Timeout(settings.AI_DEFAULT_TIMEOUT_SECONDS, connect=10),
            )
        return self._client

    async def chat(self, model: str, req: GenerateRequest) -> GenerateResponse:
        if not settings.GOOGLE_AI_STUDIO_API_KEY:
            raise ProviderError("GOOGLE_AI_STUDIO_API_KEY not configured")

        meta = MODEL_CATALOG.get(model)
        if meta is None:
            raise ProviderError(f"Model not in catalog: {model}")

        contents, system_instruction = _convert_messages(req)
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": req.temperature,
                "maxOutputTokens": req.max_tokens,
            },
        }
        if system_instruction:
            body["systemInstruction"] = {"parts": [{"text": system_instruction}]}
        if req.json_schema is not None:
            body["generationConfig"]["responseMimeType"] = "application/json"
            body["generationConfig"]["responseSchema"] = _strip_unsupported(req.json_schema)

        url = f"/models/{meta.raw_model_id}:generateContent?key={settings.GOOGLE_AI_STUDIO_API_KEY}"

        started = time.perf_counter()
        try:
            resp = await self._http().post(url, json=body)
        except httpx.TimeoutException as e:
            raise ProviderTimeout(str(e)) from e
        except httpx.HTTPError as e:
            raise ProviderError(f"HTTP error: {e}") from e

        latency_ms = int((time.perf_counter() - started) * 1000)

        if resp.status_code == 429:
            raise ProviderRateLimit(resp.text[:200])
        if 500 <= resp.status_code < 600:
            raise Provider5xx(f"{resp.status_code}: {resp.text[:200]}")
        if resp.status_code >= 400:
            raise ProviderError(f"{resp.status_code}: {resp.text[:200]}")

        payload = resp.json()
        candidates = payload.get("candidates", [])
        if not candidates:
            text = ""
            finish = "no_candidates"
        else:
            cand = candidates[0]
            parts = cand.get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)
            finish = cand.get("finishReason", "stop")

        usage_meta = payload.get("usageMetadata", {})

        return GenerateResponse(
            text=text,
            model_used=model,
            provider=Provider.GOOGLE_AI_STUDIO,
            finish_reason=finish,
            usage=Usage(
                tokens_in=int(usage_meta.get("promptTokenCount", 0)),
                tokens_out=int(usage_meta.get("candidatesTokenCount", 0)),
                cost_usd=0.0,
                latency_ms=latency_ms,
                cache_hit=False,
                cache_type="none",
            ),
        )

    async def embed(self, model: str, req: EmbedRequest) -> EmbedResponse:
        if not settings.GOOGLE_AI_STUDIO_API_KEY:
            raise ProviderError("GOOGLE_AI_STUDIO_API_KEY not configured")

        meta = MODEL_CATALOG.get(model)
        if meta is None:
            raise ProviderError(f"Model not in catalog: {model}")

        url = f"/models/{meta.raw_model_id}:batchEmbedContents?key={settings.GOOGLE_AI_STUDIO_API_KEY}"
        body = {
            "requests": [
                {
                    "model": f"models/{meta.raw_model_id}",
                    "content": {"parts": [{"text": t}]},
                }
                for t in req.texts
            ],
        }

        started = time.perf_counter()
        try:
            resp = await self._http().post(url, json=body)
        except httpx.TimeoutException as e:
            raise ProviderTimeout(str(e)) from e

        latency_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            raise ProviderError(f"{resp.status_code}: {resp.text[:200]}")

        payload = resp.json()
        vectors = [e["values"] for e in payload.get("embeddings", [])]

        return EmbedResponse(
            vectors=vectors,
            model_used=model,
            provider=Provider.GOOGLE_AI_STUDIO,
            usage=Usage(latency_ms=latency_ms),
        )


def _convert_messages(req: GenerateRequest) -> tuple[list[dict[str, Any]], str]:
    """Gemini wants {role:'user'|'model', parts:[{text}|{inlineData}]} + separate systemInstruction."""
    system = ""
    contents: list[dict[str, Any]] = []
    for m in req.messages:
        if m.role == "system":
            system = (system + "\n" + m.content).strip() if system else m.content
            continue
        role = "model" if m.role == "assistant" else "user"
        parts: list[dict[str, Any]] = [{"text": m.content}]
        if m.image_url:
            parts.append({"fileData": {"fileUri": m.image_url}})
        contents.append({"role": role, "parts": parts})
    return contents, system


def _strip_unsupported(schema: dict[str, Any]) -> dict[str, Any]:
    """Gemini schema mode does not accept all JSON Schema keywords — strip the ones it rejects."""
    out: dict[str, Any] = {}
    drop = {"$schema", "title", "$defs", "definitions", "additionalProperties", "examples"}
    for k, v in schema.items():
        if k in drop:
            continue
        if isinstance(v, dict):
            out[k] = _strip_unsupported(v)
        elif isinstance(v, list):
            out[k] = [_strip_unsupported(x) if isinstance(x, dict) else x for x in v]
        else:
            out[k] = v
    return out
