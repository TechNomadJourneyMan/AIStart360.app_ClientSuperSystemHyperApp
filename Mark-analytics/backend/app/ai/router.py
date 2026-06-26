"""Routing policy and request orchestration.

`run(req)` is the entry point called by gateway.generate().
`run_embed(req)` is the entry point for embeddings.

Pipeline:
  1. Pick primary model from ROUTING_POLICY[task]
  2. Check cost ceiling (estimate)
  3. Check key cache, then semantic cache
  4. Acquire rate-limit tokens (provider + task)
  5. Call provider with retries (3 attempts, exponential backoff)
  6. On failure → walk fallback chain
  7. Cache + telemetry + return
"""

from __future__ import annotations

import time
from datetime import timedelta
from typing import Any

from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.ai import cache as cache_mod
from app.ai.cost import calc_cost_usd, estimate_cost_usd, estimate_tokens
from app.ai.limits import provider_limiter, task_limiter
from app.ai.providers.base import (
    AIProvider,
    Provider5xx,
    ProviderError,
    ProviderRateLimit,
    ProviderTimeout,
)
from app.ai.providers.google_ai_studio import GoogleAIStudioProvider
from app.ai.providers.local_embed import LocalEmbedProvider
from app.ai.providers.mock import MockProvider
from app.ai.providers.openrouter import OpenRouterProvider
from app.ai.registry import MODEL_CATALOG, get_model, has_capability
from app.ai.telemetry import record_call
from app.ai.types import (
    EmbedRequest,
    EmbedResponse,
    GenerateRequest,
    GenerateResponse,
    Provider,
    RoutePolicy,
    Task,
)
from app.config import settings
from app.core.errors import AIGatewayUnavailable
from app.core.logging import get_logger

logger = get_logger("ai.router")


# ────────────────────────────────────────────────────────────────────
# Routing policy — single source of truth for Task → model decisions
# ────────────────────────────────────────────────────────────────────

ROUTING_POLICY: dict[Task, RoutePolicy] = {
    # ── Cheap / high-volume ──
    Task.CLASSIFY_INDUSTRY: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        fallback=["openrouter/deepseek/deepseek-chat-v3.1"],
        max_tokens=64, temperature=0.0,
        cache_ttl=timedelta(days=30), semantic_cache_threshold=0.97,
    ),
    Task.EXTRACT_CONTACTS: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        fallback=["openrouter/qwen/qwen-2.5-72b-instruct"],
        max_tokens=256, structured_output=True,
        cache_ttl=timedelta(days=30),
    ),
    Task.NORMALIZE_ADDRESS: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        fallback=["openrouter/microsoft/phi-4"],
        max_tokens=128, cache_ttl=timedelta(days=90), semantic_cache_threshold=0.98,
    ),
    Task.DETECT_LANGUAGE: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        max_tokens=16, cache_ttl=timedelta(days=180), semantic_cache_threshold=0.99,
    ),
    Task.DEDUPE_DECISION: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        fallback=["openrouter/deepseek/deepseek-chat-v3.1"],
        max_tokens=256, structured_output=True,
        cache_ttl=timedelta(days=7),
    ),

    # ── Medium ──
    Task.EXTRACT_COMPANY: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/qwen/qwen-2.5-72b-instruct",
                  "openrouter/deepseek/deepseek-chat-v3.1"],
        max_tokens=1024, structured_output=True,
        cache_ttl=timedelta(days=7),
    ),
    Task.EXTRACT_TENDER: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/deepseek/deepseek-chat-v3.1"],
        max_tokens=1024, structured_output=True,
        cache_ttl=timedelta(days=14),
    ),
    Task.EXTRACT_PERSON: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/qwen/qwen-2.5-72b-instruct"],
        max_tokens=512, structured_output=True,
        cache_ttl=timedelta(days=14),
    ),
    Task.EXTRACT_QUERY_FILTERS: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        fallback=["openrouter/microsoft/phi-4"],
        max_tokens=256, structured_output=True,
        cache_ttl=timedelta(days=30), semantic_cache_threshold=0.97,
    ),
    Task.SUMMARIZE_NEWS: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/mistralai/mistral-small-3.1-24b"],
        max_tokens=512, cache_ttl=timedelta(days=30), semantic_cache_threshold=0.95,
    ),
    Task.SUMMARIZE_REVIEWS: RoutePolicy(
        primary="openrouter/deepseek/deepseek-chat-v3.1",
        fallback=["google/gemini-2.5-flash"],
        max_tokens=512, cache_ttl=timedelta(days=7),
    ),
    Task.TAG_CONTENT: RoutePolicy(
        primary="openrouter/google/gemma-3-27b-it",
        fallback=["google/gemini-2.5-flash-8b"],
        max_tokens=128, cache_ttl=timedelta(days=14),
    ),

    # ── Complex / premium ──
    Task.GRAPH_REASONING: RoutePolicy(
        primary="google/gemini-2.5-pro",
        fallback=["openrouter/anthropic/claude-sonnet-4-6"],
        max_tokens=4096, cache_ttl=timedelta(hours=12),
        cost_ceiling_usd=0.05,
    ),
    Task.INVESTMENT_THESIS: RoutePolicy(
        primary="google/gemini-2.5-pro",
        fallback=["openrouter/anthropic/claude-sonnet-4-6"],
        max_tokens=4096, cache_ttl=timedelta(days=7),
        cost_ceiling_usd=0.10,
    ),
    Task.ANOMALY_EXPLANATION: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/deepseek/deepseek-chat-v3.1"],
        max_tokens=512, cache_ttl=timedelta(hours=24),
        cost_ceiling_usd=0.02,
    ),
    Task.OSINT_ENTITY_LINKING: RoutePolicy(
        primary="openrouter/deepseek/deepseek-r1",
        fallback=["openrouter/anthropic/claude-sonnet-4-6"],
        max_tokens=1024, structured_output=True,
        cache_ttl=timedelta(days=30),
        cost_ceiling_usd=0.05,
    ),

    # ── Vision ──
    Task.OCR_DOCUMENT: RoutePolicy(
        primary="google/gemini-2.5-flash",
        fallback=["openrouter/qwen/qwen-2.5-vl-72b"],
        max_tokens=2048, cache_ttl=None,                    # raw OCR — not cached
    ),
    Task.VISION_LOGO: RoutePolicy(
        primary="google/gemini-2.5-flash-8b",
        max_tokens=256, cache_ttl=timedelta(days=180),
    ),

    # ── Embeddings (handled in run_embed, not chat) ──
    Task.EMBED_COMPANY_PROFILE: RoutePolicy(
        primary="local/bge-m3", fallback=["google/text-embedding-004"], max_tokens=0,
    ),
    Task.EMBED_QUERY: RoutePolicy(
        primary="local/bge-m3", fallback=["google/text-embedding-004"], max_tokens=0,
    ),
    Task.EMBED_NEWS: RoutePolicy(
        primary="local/bge-m3", fallback=["google/text-embedding-004"], max_tokens=0,
    ),
}


# ────────────────────────────────────────────────────────────────────
# Provider singletons
# ────────────────────────────────────────────────────────────────────

_providers: dict[Provider, AIProvider] = {
    Provider.OPENROUTER: OpenRouterProvider(),
    Provider.GOOGLE_AI_STUDIO: GoogleAIStudioProvider(),
    Provider.LOCAL: LocalEmbedProvider(),
    Provider.MOCK: MockProvider(),
}


def set_provider(p: Provider, impl: AIProvider) -> None:
    """Override a provider (used by tests)."""
    _providers[p] = impl


def get_provider(p: Provider) -> AIProvider:
    return _providers[p]


# ────────────────────────────────────────────────────────────────────
# Public entry points
# ────────────────────────────────────────────────────────────────────


async def run(req: GenerateRequest) -> GenerateResponse:
    if req.task not in ROUTING_POLICY:
        raise AIGatewayUnavailable(f"No routing policy for task {req.task}", code="NO_POLICY")
    policy = ROUTING_POLICY[req.task]

    # Force model override (testing)
    chain = [req.force_model] if req.force_model else [policy.primary, *policy.fallback]

    # Vision guard — if any message has image, restrict to vision-capable models
    if any(m.image_url for m in req.messages):
        chain = [m for m in chain if has_capability(m, "vision")]
        if not chain:
            raise AIGatewayUnavailable("No vision-capable model in chain", code="NO_VISION_MODEL")

    # Cost ceiling pre-check (on primary)
    if policy.cost_ceiling_usd is not None:
        est = estimate_cost_usd(chain[0], _estimate_tokens_in(req), req.max_tokens)
        if est > policy.cost_ceiling_usd:
            raise AIGatewayUnavailable(
                f"Estimated cost ${est:.4f} exceeds ceiling ${policy.cost_ceiling_usd}",
                code="COST_CEILING",
            )

    # Key cache check (use primary's fingerprint)
    cached = await cache_mod.key_cache.get(req, chain[0])
    if cached:
        await record_call(
            request_id=req.request_id, agent=req.agent, task=req.task.value,
            model=cached.model_used, provider=cached.provider.value,
            tokens_in=cached.usage.tokens_in, tokens_out=cached.usage.tokens_out,
            cost_usd=0.0, latency_ms=cached.usage.latency_ms,
            cache_hit=True, cache_type="key",
        )
        return cached

    # Semantic cache (if policy allows)
    if policy.semantic_cache_threshold is not None and not req.force_refresh:
        prompt_text = _prompt_text(req)
        sem_payload = await cache_mod.semantic_cache.get(
            req.task, prompt_text, policy.semantic_cache_threshold
        )
        if sem_payload:
            resp = cache_mod.hydrate_from_semantic(sem_payload)
            await record_call(
                request_id=req.request_id, agent=req.agent, task=req.task.value,
                model=resp.model_used, provider=resp.provider.value,
                tokens_in=resp.usage.tokens_in, tokens_out=resp.usage.tokens_out,
                cost_usd=0.0, latency_ms=resp.usage.latency_ms,
                cache_hit=True, cache_type="semantic",
            )
            return resp

    # Walk the chain
    last_error: Exception | None = None
    for qualified_model in chain:
        meta = get_model(qualified_model)
        provider = get_provider(meta.provider)
        try:
            async with provider_limiter(meta.provider):
                async with task_limiter(req.task):
                    resp = await _attempt_with_retry(provider, qualified_model, req)
        except (ProviderError, RetryError) as e:
            last_error = e
            logger.warning("provider_failed",
                            model=qualified_model, error=str(e))
            await record_call(
                request_id=req.request_id, agent=req.agent, task=req.task.value,
                model=qualified_model, provider=meta.provider.value,
                tokens_in=0, tokens_out=0, cost_usd=0.0, latency_ms=0,
                cache_hit=False, cache_type=None, error=str(e)[:512],
            )
            continue

        # Success — finalize cost + cache + telemetry
        resp.usage.cost_usd = calc_cost_usd(qualified_model, resp.usage.tokens_in, resp.usage.tokens_out)
        if policy.cache_ttl is not None:
            await cache_mod.key_cache.put(req, qualified_model, resp, policy.cache_ttl)
            if policy.semantic_cache_threshold is not None:
                await cache_mod.semantic_cache.put(req.task, _prompt_text(req), resp, policy.cache_ttl)

        await record_call(
            request_id=req.request_id, agent=req.agent, task=req.task.value,
            model=qualified_model, provider=meta.provider.value,
            tokens_in=resp.usage.tokens_in, tokens_out=resp.usage.tokens_out,
            cost_usd=resp.usage.cost_usd, latency_ms=resp.usage.latency_ms,
            cache_hit=False, cache_type=None,
        )
        return resp

    raise AIGatewayUnavailable(
        f"All providers failed for task {req.task}: {last_error}",
        code="ALL_PROVIDERS_FAILED",
    )


async def run_embed(req: EmbedRequest) -> EmbedResponse:
    policy = ROUTING_POLICY.get(req.task)
    if policy is None:
        # Default embedding policy
        chain = ["local/bge-m3", "google/text-embedding-004"]
    else:
        chain = [policy.primary, *policy.fallback]

    last_error: Exception | None = None
    for qualified_model in chain:
        meta = get_model(qualified_model)
        provider = get_provider(meta.provider)
        try:
            resp = await provider.embed(qualified_model, req)
        except (ProviderError, NotImplementedError) as e:
            last_error = e
            logger.warning("embed_provider_failed", model=qualified_model, error=str(e))
            continue
        # Embeddings: typically free or trivial cost; we still log.
        await record_call(
            request_id=req.request_id, agent="embeddings", task=req.task.value,
            model=qualified_model, provider=meta.provider.value,
            tokens_in=sum(estimate_tokens(t) for t in req.texts),
            tokens_out=0, cost_usd=0.0,
            latency_ms=resp.usage.latency_ms,
            cache_hit=False, cache_type=None,
        )
        return resp

    raise AIGatewayUnavailable(
        f"All embed providers failed: {last_error}", code="EMBED_ALL_FAILED"
    )


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


async def _attempt_with_retry(
    provider: AIProvider, model: str, req: GenerateRequest
) -> GenerateResponse:
    retry_on = (ProviderRateLimit, Provider5xx, ProviderTimeout)
    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(3),
        wait=wait_exponential(min=1, max=8),
        retry=retry_if_exception_type(retry_on),
        reraise=True,
    ):
        with attempt:
            return await provider.chat(model, req)
    raise RuntimeError("unreachable")  # for mypy


def _prompt_text(req: GenerateRequest) -> str:
    return "\n".join(m.content for m in req.messages)


def _estimate_tokens_in(req: GenerateRequest) -> int:
    return sum(estimate_tokens(m.content) for m in req.messages)
