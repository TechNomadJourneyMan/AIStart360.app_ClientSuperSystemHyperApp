"""Token → USD cost calculator."""

from __future__ import annotations

from app.ai.registry import get_model


def calc_cost_usd(qualified_model: str, tokens_in: int, tokens_out: int) -> float:
    """Calculate USD cost from token counts using catalog pricing.

    Example:
        >>> calc_cost_usd("google/gemini-2.5-flash", 1000, 500)
        # 1000/1M * 0.075 + 500/1M * 0.30 = 0.000075 + 0.00015 = 0.000225
    """
    meta = get_model(qualified_model)
    return (tokens_in / 1_000_000) * meta.price_in_per_m + (tokens_out / 1_000_000) * meta.price_out_per_m


def estimate_cost_usd(qualified_model: str, estimated_tokens_in: int, max_tokens_out: int) -> float:
    """Worst-case estimate, used before sending a request to check cost ceilings."""
    return calc_cost_usd(qualified_model, estimated_tokens_in, max_tokens_out)


def estimate_tokens(text: str) -> int:
    """Rough estimate: ~4 chars per token for mixed RU/EN text. Use for ceiling checks only."""
    return max(1, len(text) // 4)
