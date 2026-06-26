"""Model catalog with pricing and capabilities. Source of truth for cost.py and router.py.

Prices reflect 2026-01 snapshots from provider docs. Drift detection script:
`scripts/check_model_prices.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.ai.types import Provider


Capability = Literal["chat", "json_schema", "vision", "long_context", "reasoning", "embedding"]


@dataclass(frozen=True, slots=True)
class ModelMeta:
    """One model's metadata: routing, pricing, capabilities."""

    qualified_name: str                        # 'google/gemini-2.5-flash-8b' or 'openrouter/...'
    provider: Provider
    raw_model_id: str                          # what the provider expects ('gemini-2.5-flash-8b', 'deepseek/deepseek-chat-v3.1')
    context_window: int                        # tokens
    price_in_per_m: float                      # USD per 1M input tokens
    price_out_per_m: float                     # USD per 1M output tokens
    capabilities: frozenset[Capability] = field(default_factory=frozenset)
    free_rpm: int | None = None                # if has free tier
    avg_latency_ms: int = 1500                 # rough p50 for budgeting
    embedding_dimensions: int | None = None


def _m(
    qualified: str,
    provider: Provider,
    raw: str,
    ctx: int,
    p_in: float,
    p_out: float,
    *caps: Capability,
    free_rpm: int | None = None,
    avg_latency_ms: int = 1500,
    embed_dim: int | None = None,
) -> tuple[str, ModelMeta]:
    return qualified, ModelMeta(
        qualified_name=qualified,
        provider=provider,
        raw_model_id=raw,
        context_window=ctx,
        price_in_per_m=p_in,
        price_out_per_m=p_out,
        capabilities=frozenset(caps),
        free_rpm=free_rpm,
        avg_latency_ms=avg_latency_ms,
        embedding_dimensions=embed_dim,
    )


MODEL_CATALOG: dict[str, ModelMeta] = dict(
    [
        # ── Google AI Studio ──
        _m("google/gemini-2.5-flash-8b", Provider.GOOGLE_AI_STUDIO, "gemini-2.5-flash-8b",
           1_000_000, 0.0375, 0.15, "chat", "json_schema", "vision",
           free_rpm=4000, avg_latency_ms=600),
        _m("google/gemini-2.5-flash", Provider.GOOGLE_AI_STUDIO, "gemini-2.5-flash",
           1_000_000, 0.075, 0.30, "chat", "json_schema", "vision", "long_context",
           free_rpm=1500, avg_latency_ms=900),
        _m("google/gemini-2.5-pro", Provider.GOOGLE_AI_STUDIO, "gemini-2.5-pro",
           2_000_000, 1.25, 5.00, "chat", "json_schema", "vision", "long_context", "reasoning",
           free_rpm=50, avg_latency_ms=4500),
        _m("google/text-embedding-004", Provider.GOOGLE_AI_STUDIO, "text-embedding-004",
           2048, 0.0, 0.0, "embedding", free_rpm=1500, avg_latency_ms=200, embed_dim=768),

        # ── OpenRouter — cheap ──
        _m("openrouter/deepseek/deepseek-chat-v3.1", Provider.OPENROUTER, "deepseek/deepseek-chat-v3.1",
           64_000, 0.27, 1.10, "chat", "json_schema", avg_latency_ms=1500),
        _m("openrouter/qwen/qwen-2.5-72b-instruct", Provider.OPENROUTER, "qwen/qwen-2.5-72b-instruct",
           32_000, 0.40, 0.40, "chat", "json_schema", avg_latency_ms=1800),
        _m("openrouter/qwen/qwen3-32b", Provider.OPENROUTER, "qwen/qwen3-32b",
           128_000, 0.20, 0.60, "chat", "json_schema", "long_context", avg_latency_ms=1600),
        _m("openrouter/meta-llama/llama-3.3-70b-instruct", Provider.OPENROUTER,
           "meta-llama/llama-3.3-70b-instruct", 128_000, 0.39, 0.39, "chat", "json_schema",
           "long_context", avg_latency_ms=1700),
        _m("openrouter/mistralai/mistral-small-3.1-24b", Provider.OPENROUTER,
           "mistralai/mistral-small-3.1-24b", 128_000, 0.10, 0.30, "chat", "json_schema",
           "long_context", avg_latency_ms=1200),
        _m("openrouter/google/gemma-3-27b-it", Provider.OPENROUTER, "google/gemma-3-27b-it",
           128_000, 0.20, 0.40, "chat", "json_schema", avg_latency_ms=1400),
        _m("openrouter/microsoft/phi-4", Provider.OPENROUTER, "microsoft/phi-4",
           16_000, 0.07, 0.14, "chat", avg_latency_ms=900),

        # ── OpenRouter — premium ──
        _m("openrouter/anthropic/claude-sonnet-4-6", Provider.OPENROUTER, "anthropic/claude-sonnet-4-6",
           200_000, 3.00, 15.00, "chat", "json_schema", "vision", "long_context", "reasoning",
           avg_latency_ms=3500),
        _m("openrouter/anthropic/claude-haiku-4-5", Provider.OPENROUTER, "anthropic/claude-haiku-4-5",
           200_000, 1.00, 5.00, "chat", "json_schema", "vision", "long_context", avg_latency_ms=1800),
        _m("openrouter/deepseek/deepseek-r1", Provider.OPENROUTER, "deepseek/deepseek-r1",
           64_000, 0.55, 2.19, "chat", "json_schema", "reasoning", avg_latency_ms=4000),

        # ── OpenRouter — vision ──
        _m("openrouter/qwen/qwen-2.5-vl-72b", Provider.OPENROUTER, "qwen/qwen-2.5-vl-72b",
           32_000, 0.40, 0.40, "chat", "json_schema", "vision", avg_latency_ms=2200),

        # ── Local embeddings ──
        _m("local/bge-m3", Provider.LOCAL, "BAAI/bge-m3",
           8192, 0.0, 0.0, "embedding", avg_latency_ms=50, embed_dim=1024),
    ]
)


def get_model(qualified: str) -> ModelMeta:
    if qualified not in MODEL_CATALOG:
        raise ValueError(f"Unknown model: {qualified}. Add it to MODEL_CATALOG.")
    return MODEL_CATALOG[qualified]


def has_capability(qualified: str, capability: Capability) -> bool:
    return capability in get_model(qualified).capabilities
