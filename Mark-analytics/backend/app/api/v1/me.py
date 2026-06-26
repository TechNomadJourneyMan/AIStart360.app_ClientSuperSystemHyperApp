"""Self-service `/me` endpoints — profile, usage counters, limits, subscription.

Powers the freemium UI (e.g. "12 / 50 searches used"). All endpoints are
JWT-protected; the response always reflects the authenticated caller, never
an arbitrary user_id.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.billing import quota
from app.billing.tier import QUOTAS, Tier, get_user_tier
from app.core.deps import CurrentUserDep, SessionDep
from app.core.errors import envelope
from app.schemas.me import (
    LimitsResponse,
    SubscriptionInfo,
    UsageCounter,
    UsageResponse,
    UserProfile,
)
from app.services.users import ensure_user_exists

router = APIRouter()


_PLAN_LABELS: dict[str, str] = {
    Tier.FREE.value: "Free",
    Tier.STARTER.value: "Starter",
    Tier.PRO.value: "Pro",
    Tier.BUSINESS.value: "Business",
    Tier.ENTERPRISE.value: "Enterprise",
}


@router.get("", summary="Current authenticated user (profile)")
async def me(user: CurrentUserDep, session: SessionDep) -> dict[str, Any]:
    db_user = await ensure_user_exists(session, user)
    return envelope(data=UserProfile.model_validate(db_user).model_dump(mode="json"))


@router.get("/usage", summary="Current monthly usage counters")
async def usage(user: CurrentUserDep, session: SessionDep) -> dict[str, Any]:
    db_user = await ensure_user_exists(session, user)
    tier = await get_user_tier(user)
    counters = await quota.current_usage(user.user_id)
    limits = quota.limits_for(tier)
    reset_at = quota.next_reset_at()

    response = UsageResponse(
        searches=UsageCounter(
            used=counters["searches"], limit=limits["searches"], reset_at=reset_at,
        ),
        profiles=UsageCounter(
            used=counters["profiles"], limit=limits["profiles"], reset_at=reset_at,
        ),
        forecasts=UsageCounter(
            used=counters["forecasts"], limit=limits["forecasts"], reset_at=reset_at,
        ),
        uploads=UsageCounter(
            used=counters["uploads"], limit=limits["uploads"], reset_at=reset_at,
        ),
    )
    return envelope(
        data=response.model_dump(mode="json"),
        meta={"plan": db_user.plan, "tier": tier.value},
    )


@router.get("/limits", summary="Per-tier static limits for the current user")
async def limits(user: CurrentUserDep) -> dict[str, Any]:
    tier = await get_user_tier(user)
    q = QUOTAS[tier]
    response = LimitsResponse(
        plan=tier.value,
        searches_per_month=q.searches_per_month,
        profiles_per_month=q.profiles_per_month,
        alerts_max=q.alerts_max,
        forecasts_per_month=q.forecasts_per_month,
        uploads_per_month=q.uploads_per_month,
        upload_size_mb=q.upload_size_mb,
        storage_mb=q.storage_mb,
        api_rpm=q.api_rpm,
    )
    return envelope(data=response.model_dump(mode="json"))


@router.get("/subscription", summary="Read-only subscription summary")
async def subscription(user: CurrentUserDep) -> dict[str, Any]:
    tier = await get_user_tier(user)
    response = SubscriptionInfo(
        plan=tier.value,
        plan_label=_PLAN_LABELS.get(tier.value, tier.value.title()),
        status="active",
        current_period_end=None,
    )
    return envelope(data=response.model_dump(mode="json"))
