"""Competitor wizard schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WizardOption(BaseModel):
    key: str
    label: str


class CompetitorWizardOptions(BaseModel):
    """GET /competitors/options — choices the wizard offers."""

    categories: list[dict[str, str]]
    audiences: list[WizardOption]
    stages: list[WizardOption]
    prices: list[WizardOption]
    regions: list[WizardOption]


class MatchedNiche(BaseModel):
    model_config = {"extra": "allow"}

    category: str
    category_label: str | None = None
    industries: list[str] = Field(default_factory=list)
    nace_sections: list[str] = Field(default_factory=list)
    audience: str | None = None
    stage: str | None = None
    regions: list[str] = Field(default_factory=list)
    price_segment: str | None = None
    tags_required: list[str] = Field(default_factory=list)


class CompetitorEntry(BaseModel):
    id: str
    name: str
    country: str | None = None
    industry_code: str | None = None
    industry_label: str | None = None
    employee_count: int | None = None
    revenue_usd: float | None = None
    website: str | None = None
    tags: list[str] = Field(default_factory=list)
    tag_match_score: int = 0
    latitude: float | None = None
    longitude: float | None = None
    region_name: str | None = None
    city_name: str | None = None
    size_category: str | None = None
    market_share_pct: float = 0.0


# ─────────────────────────────────────────────────────────────
# Market block (full niche universe aggregates)
# ─────────────────────────────────────────────────────────────

class SizeBucket(BaseModel):
    key: str
    label: str
    count: int


class RegionBucket(BaseModel):
    region_kato: str | None = None
    region_name: str | None = None
    count: int
    revenue_usd: float


class RevenueBucket(BaseModel):
    label: str
    min: float
    max: float | None = None
    count: int


class TopShare(BaseModel):
    name: str
    revenue_usd: float
    share_pct: float


class MarketStats(BaseModel):
    company_count_total: int
    market_volume_usd: float
    tam_usd: float
    sam_usd: float
    som_usd: float
    avg_revenue_usd: float
    median_revenue_usd: float
    avg_employee_count: int
    total_employees: int
    hhi: float
    concentration_top3_pct: float
    competition_level: str
    size_distribution: list[SizeBucket] = Field(default_factory=list)
    region_distribution: list[RegionBucket] = Field(default_factory=list)
    revenue_buckets: list[RevenueBucket] = Field(default_factory=list)
    top_shares: list[TopShare] = Field(default_factory=list)
    addressable_pct: float = 0.30
    obtainable_pct: float = 0.05
    status: str = "ok"
    message: str | None = None


class CompetitorSummary(BaseModel):
    model_config = {"extra": "allow"}

    status: str
    message: str
    competitor_count: int | None = None
    total_revenue_usd: float | None = None
    avg_employee_count: int | None = None
    leader: dict[str, Any] | None = None
    concentration: float | None = None


class CompetitorWizardResult(BaseModel):
    """POST /competitors/wizard."""

    matched_niche: MatchedNiche
    competitors: list[CompetitorEntry]
    total: int
    market: MarketStats
    summary: CompetitorSummary


# ─────────────────────────────────────────────────────────────
# Niche map (GeoJSON)
# ─────────────────────────────────────────────────────────────

class NicheGeoFeature(BaseModel):
    type: str = "Feature"
    id: str
    geometry: dict[str, Any]
    properties: dict[str, Any]


class NicheFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[NicheGeoFeature] = Field(default_factory=list)
    total: int = 0
