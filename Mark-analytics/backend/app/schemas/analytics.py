"""Analytics endpoint schemas — typed shapes for dashboard widgets."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["ok", "info", "warn", "danger"]


class AnalyticsOverview(BaseModel):
    """Top-line KPIs returned by GET /analytics/overview."""

    model_config = ConfigDict(extra="allow")

    total_companies: int
    active: int
    liquidated: int
    mortality_rate_pct: float
    revenue_total_usd: float
    revenue_avg_usd: float
    revenue_median_usd: float
    employees_total: int
    employees_avg: float
    countries_count: int
    industries_count: int
    new_this_month: int


class IndustryDistributionItem(BaseModel):
    industry_code: str | None = None
    industry_label: str | None = None
    companies: int
    revenue_usd: float
    employees: int


class CountryDistributionItem(BaseModel):
    country: str | None = None
    companies: int
    active: int
    revenue_usd: float
    employees: int


class GrowthLeaderItem(BaseModel):
    id: str
    name: str
    country: str | None = None
    industry_label: str | None = None
    revenue_usd: float
    employees: int | None = None
    tags: list[str] = Field(default_factory=list)


class SizeBucketItem(BaseModel):
    bucket: str
    companies: int
    revenue_usd: float


class StatusBreakdownItem(BaseModel):
    status: str | None = None
    companies: int


class AnalyticsInsightCard(BaseModel):
    """Rule-based market insight card."""

    model_config = ConfigDict(extra="allow")

    severity: Severity = "info"
    title: str
    body: str
    evidence: dict[str, Any] = Field(default_factory=dict)


class CompanyInsightsBundle(BaseModel):
    """Returned by GET /companies/{id}/insights — bundles scores + cards."""

    scores: dict[str, Any]
    insights: list[dict[str, Any]] = Field(default_factory=list)


class RegionDistributionItem(BaseModel):
    region_kato: str | None = None
    region_name: str | None = None
    value: float
    percent_of_total: float | None = None


class CityDistributionItem(BaseModel):
    city_name: str | None = None
    value: float
    percent_of_total: float | None = None
