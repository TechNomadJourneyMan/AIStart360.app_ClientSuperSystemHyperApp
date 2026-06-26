"""Per-user monthly quota counters (Redis-backed)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

import redis.asyncio as redis_aio

from app.billing.tier import Tier, quota_for
from app.config import settings
from app.core.errors import QuotaExceededError

QuotaKey = Literal["searches", "profiles", "forecasts", "uploads"]

QUOTA_KEYS: tuple[QuotaKey, ...] = ("searches", "profiles", "forecasts", "uploads")


_redis: redis_aio.Redis | None = None


async def _redis_pool() -> redis_aio.Redis:
    global _redis
    if _redis is None:
        _redis = redis_aio.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


def _month_bucket() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year}-{now.month:02d}"


def _key(user_id: str, quota: QuotaKey) -> str:
    return f"quota:{quota}:{_month_bucket()}:{user_id}"


def _next_month_reset_iso() -> str:
    """First moment of the next UTC month — when the monthly bucket rolls over."""
    now = datetime.now(timezone.utc)
    if now.month == 12:
        nxt = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0,
                          second=0, microsecond=0)
    else:
        nxt = now.replace(month=now.month + 1, day=1, hour=0, minute=0,
                          second=0, microsecond=0)
    return nxt.isoformat()


async def check_and_increment(
    user_id: str, tier: Tier, quota: QuotaKey, *, amount: int = 1
) -> int:
    """Atomically increment counter; raise QuotaExceededError if it would exceed monthly cap."""
    q = quota_for(tier)
    cap = {
        "searches": q.searches_per_month,
        "profiles": q.profiles_per_month,
        "forecasts": q.forecasts_per_month,
        "uploads": q.uploads_per_month,
    }[quota]

    r = await _redis_pool()
    key = _key(user_id, quota)
    new_value = await r.incrby(key, amount)
    if new_value == amount:
        # First increment of the month — set TTL to ~35 days for safety.
        await r.expire(key, 60 * 60 * 24 * 35)

    if new_value > cap:
        await r.decrby(key, amount)
        raise QuotaExceededError(
            f"Monthly quota for {quota} ({cap}) exceeded on tier {tier.value}",
            kind=quota,
            used=cap,
            limit=cap,
            reset_at=_next_month_reset_iso(),
            tier=tier.value,
        )
    return new_value


async def current_usage(user_id: str) -> dict[str, int]:
    r = await _redis_pool()
    out: dict[str, int] = {}
    for q in QUOTA_KEYS:
        v = await r.get(_key(user_id, q))
        out[q] = int(v) if v else 0
    return out


def next_reset_at(now: datetime | None = None) -> datetime:
    """First instant of the next UTC calendar month — when monthly counters roll over."""
    now = now or datetime.now(timezone.utc)
    if now.month == 12:
        return datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    return datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)


def limits_for(tier: Tier) -> dict[str, int]:
    """Per-quota-kind monthly caps for the given tier."""
    q = quota_for(tier)
    return {
        "searches": q.searches_per_month,
        "profiles": q.profiles_per_month,
        "forecasts": q.forecasts_per_month,
        "uploads": q.uploads_per_month,
    }
