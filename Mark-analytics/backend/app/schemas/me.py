"""Self-service `/me` schemas — profile, usage, limits, subscription."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserProfile(BaseModel):
    """Subset of `users` row safe to return to the owning user."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    plan: str
    role: str
    org_id: UUID | None = None
    created_at: datetime


class UsageCounter(BaseModel):
    """Per-quota-kind monthly counter."""

    used: int = Field(ge=0)
    limit: int = Field(ge=0, description="Monthly cap for the user's current tier")
    reset_at: datetime = Field(description="UTC timestamp when this counter rolls over")


class UsageResponse(BaseModel):
    """Map of quota kind -> counter. One entry per quota kind in `TierQuota`."""

    searches: UsageCounter
    profiles: UsageCounter
    forecasts: UsageCounter
    uploads: UsageCounter


class LimitsResponse(BaseModel):
    """All numeric limits for the user's current tier (mirrors `TierQuota`)."""

    plan: str
    searches_per_month: int
    profiles_per_month: int
    alerts_max: int
    forecasts_per_month: int
    uploads_per_month: int
    upload_size_mb: int
    storage_mb: int
    api_rpm: int


class SubscriptionInfo(BaseModel):
    """Read-only subscription summary. Billing lives in AIStart360 — this is a mirror."""

    plan: str
    plan_label: str
    status: str = "active"
    current_period_end: datetime | None = None
