"""Pydantic schemas for the `sources` registry."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


AuthType = Literal["none", "api_key", "oauth", "registration"]
ResponseFormat = Literal["json", "xml", "csv", "rss", "html"]
GeoScope = Literal["kz", "cis", "global", "regional"]
HealthStatus = Literal["ok", "degraded", "down", "untested"]


class FreeTierLimits(BaseModel):
    model_config = ConfigDict(extra="allow")

    requests_per_minute: int | None = None
    requests_per_hour: int | None = None
    requests_per_day: int | None = None
    requests_per_month: int | None = None
    notes: str | None = None


class SourceListItem(BaseModel):
    """Compact entry returned by `GET /admin/sources`."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    name: str
    kind: str
    category: str | None = None
    geo_scope: str | None = None
    priority: int
    enabled: bool
    auth_type: str | None = None
    health_status: str | None = None
    last_health_check: datetime | None = None


class SourceInfo(SourceListItem):
    """Full record returned by `GET /admin/sources/{key}`."""

    base_url: str
    rate_limit_rpm: int
    refresh_min_hours: int
    refresh_max_hours: int
    docs_url: str | None = None
    response_format: str | None = None
    free_tier_limits: dict[str, Any] | None = None
    notes: str | None = None


class SourceUpdate(BaseModel):
    """Mutable fields for `PATCH /admin/sources/{key}`."""

    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=10)
    notes: str | None = None
    rate_limit_rpm: int | None = Field(default=None, ge=1, le=10_000)
    refresh_min_hours: int | None = Field(default=None, ge=1)
    refresh_max_hours: int | None = Field(default=None, ge=1)
    auth_type: AuthType | None = None
    category: str | None = None
    geo_scope: GeoScope | None = None


class HealthCheckResult(BaseModel):
    key: str
    base_url: str
    status: HealthStatus
    http_status: int | None = None
    latency_ms: int | None = None
    checked_at: datetime
    error: str | None = None
