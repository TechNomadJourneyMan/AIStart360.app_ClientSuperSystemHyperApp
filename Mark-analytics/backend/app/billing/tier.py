"""Subscription tier resolution + quota enforcement.

Source of truth for tier is AIStart360 main app (table `aistart360.subscriptions`).
Backend caches in Redis (5 min TTL) and falls back to `users.plan` denorm column.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import redis.asyncio as redis_aio

from app.config import settings
from app.core.errors import TierRequiredError
from app.core.security import SupabaseUserClaims


class Tier(StrEnum):
    FREE = "free"
    STARTER = "starter"
    PRO = "pro"
    BUSINESS = "business"
    ENTERPRISE = "enterprise"


@dataclass(frozen=True, slots=True)
class TierQuota:
    searches_per_month: int
    profiles_per_month: int
    alerts_max: int
    forecasts_per_month: int
    uploads_per_month: int
    upload_size_mb: int
    storage_mb: int
    api_rpm: int


QUOTAS: dict[Tier, TierQuota] = {
    Tier.FREE:       TierQuota(50,        5,    0,   0,    1,   5,    25,    30),
    Tier.STARTER:    TierQuota(1_000,     50,   3,   5,    10,  25,   500,   300),
    Tier.PRO:        TierQuota(10_000,    500,  25,  10_000, 100, 100,  5_000, 1000),
    Tier.BUSINESS:   TierQuota(100_000,   1_000_000, 100, 1_000_000, 1000, 500, 50_000, 3000),
    Tier.ENTERPRISE: TierQuota(10_000_000, 10_000_000, 10_000, 10_000_000, 10_000, 5_000, 1_000_000, 10_000),
}


_redis: redis_aio.Redis | None = None


async def _redis_pool() -> redis_aio.Redis:
    global _redis
    if _redis is None:
        _redis = redis_aio.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def get_user_tier(claims: SupabaseUserClaims) -> Tier:
    """Resolve current tier. Order: Redis cache → app_metadata claim → FREE."""
    r = await _redis_pool()
    cached = await r.get(f"tier:{claims.user_id}")
    if cached:
        try:
            return Tier(cached)
        except ValueError:
            pass

    # Read from app_metadata (set by AIStart360 webhook after subscription change)
    plan = claims.app_metadata.get("plan", "free")
    try:
        tier = Tier(plan)
    except ValueError:
        tier = Tier.FREE

    await r.setex(f"tier:{claims.user_id}", 300, tier.value)
    return tier


def quota_for(tier: Tier) -> TierQuota:
    return QUOTAS[tier]


async def invalidate_tier_cache(user_id: str) -> None:
    r = await _redis_pool()
    await r.delete(f"tier:{user_id}")


def require_min_tier(user_tier: Tier, minimum: Tier) -> None:
    """Raise TierRequiredError (HTTP 402) if user tier is below the minimum."""
    order = list(QUOTAS.keys())
    if order.index(user_tier) < order.index(minimum):
        raise TierRequiredError(
            f"This feature requires {minimum.value} tier or higher "
            f"(you are on {user_tier.value})",
            tier_required=minimum.value,
            tier_current=user_tier.value,
        )
