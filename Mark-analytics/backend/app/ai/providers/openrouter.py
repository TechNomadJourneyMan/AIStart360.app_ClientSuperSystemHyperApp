"""OpenRouter provider — OpenAI-compatible chat completions."""

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
from app.ai.types import GenerateRequest, GenerateResponse, Provider, Usage
from app.config import settings
from app.core.logging import get_logger

logger = get_logger("ai.openrouter")


class OpenRouterProvider(AIProvider):
    provider = Provider.OPENROUTER

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            headers = {
                "Authorization": f"Bearer {settings.OPENROUTER_API_KEY or ''}",
                "Content-Type": "application/json",
            }
            if settings.OPENROUTER_HTTP_REFERER:
                headers["HTTP-Referer"] = settings.OPENROUTER_HTTP_REFERER
            headers["X-Title"] = settings.OPENROUTER_APP_NAME
            self._client = httpx.AsyncClient(
                base_url=settings.OPENROUTER_BASE_URL,
                headers=headers,
                timeout=httpx.Timeout(settings.AI_DEFAULT_TIMEOUT_SECONDS, connect=10),
            )
        return self._client

    async def chat(self, model: str, req: GenerateRequest) -> GenerateResponse:
        if not settings.OPENROUTER_API_KEY:
            raise ProviderError("OPENROUTER_API_KEY not configured")

        # `model` here is the catalog key like 'openrouter/deepseek/deepseek-chat-v3.1'
        meta = MODEL_CATALOG.get(model)
        if meta is None:
            raise ProviderError(f"Model not in catalog: {model}")

        body: dict[str, Any] = {
            "model": meta.raw_model_id,
            "messages": _convert_messages(req),
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
        }
        if req.json_schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "response",
                    "schema": req.json_schema,
                    "strict": True,
                },
            }

        started = time.perf_counter()
        try:
            resp = await self._http().post("/chat/completions", json=body)
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
        choice = payload["choices"][0]
        msg = choice["message"]
        usage = payload.get("usage", {})

        text = msg.get("content") or ""

        return GenerateResponse(
            text=text,
            model_used=model,
            provider=Provider.OPENROUTER,
            finish_reason=choice.get("finish_reason"),
            usage=Usage(
                tokens_in=int(usage.get("prompt_tokens", 0)),
                tokens_out=int(usage.get("completion_tokens", 0)),
                cost_usd=0.0,    # filled by router using cost.calc_cost_usd
                latency_ms=latency_ms,
                cache_hit=False,
                cache_type="none",
            ),
        )


def _convert_messages(req: GenerateRequest) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in req.messages:
        if m.image_url:
            out.append({
                "role": m.role,
                "content": [
                    {"type": "text", "text": m.content},
                    {"type": "image_url", "image_url": {"url": m.image_url}},
                ],
            })
        else:
            entry: dict[str, Any] = {"role": m.role, "content": m.content}
            if m.name:
                entry["name"] = m.name
            out.append(entry)
    return out
