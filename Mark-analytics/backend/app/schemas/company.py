"""Company API schemas."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class IndustryRef(BaseModel):
    code: str | None = None
    label: str | None = None


class AddressShort(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    country: str | None = None
    region: str | None = None
    city: str | None = None
    street: str | None = None


class CompanyListItem(BaseModel):
    """Shape for list endpoints — cheap, joined."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    bin: str | None = None
    name: str
    country: str
    legal_form: str | None = None
    status: str | None = None
    industry: IndustryRef | None = None
    registered_at: date | None = None
    employee_count: int | None = None
    revenue_usd: Decimal | None = None
    website: str | None = None
    tags: list[str] | None = None
    confidence: float | None = None
    # KZ enrichment (migration 0003) — visible in table columns
    size_category: str | None = None
    ownership_type_detail: str | None = None
    kato_code: str | None = None
    data_source: str | None = None
    # Denormalized geo (migration 0004) — used by /companies/map without JOIN
    latitude: float | None = None
    longitude: float | None = None
    region_kato: str | None = None
    region_name: str | None = None
    city_name: str | None = None
    updated_at: datetime


class FieldProvenanceEntry(BaseModel):
    value: Any = None
    source_page_id: UUID | None = None
    extracted_at: datetime
    extractor: str
    confidence: float


Severity = Literal["ok", "info", "warn", "danger"]


class CompanyInsight(BaseModel):
    """Rule-based insight card. No AI required."""

    severity: Severity = "info"
    title: str
    body: str
    evidence: dict[str, Any] = Field(default_factory=dict)


class TimelineEvent(BaseModel):
    """A single event in the company timeline. Mixed signals."""

    at: datetime
    kind: str
    label: str
    payload: dict[str, Any] = Field(default_factory=dict)


class CompanyScores(BaseModel):
    """Computed scalar metrics for a company. No ML, pure formulas."""

    digital_maturity: int = Field(ge=0, le=5)
    data_completeness_pct: float = Field(ge=0, le=100)
    freshness_days: int = Field(ge=0)
    confidence_score: float = Field(ge=0, le=1)
    risk_level: Literal["low", "medium", "high"] = "low"
    ai_growth_score: float = Field(ge=0, le=100)


class DataQuality(BaseModel):
    """Trust-signal envelope surfaced on `/companies/{id}` per §11 PR #5.

    `recent_changes` is `None` when no CDC rows exist AND no freshness has been
    recorded — frontend hides the badge instead of rendering a misleading zero.
    """

    confidence: Literal["high", "medium", "low"]
    freshness_at: datetime | None = None
    completeness_pct: int = Field(ge=0, le=100)
    recent_changes: int | None = None


class CompanyDetail(CompanyListItem):
    """Full detail view including provenance + related entities + insights."""

    description: str | None = None
    inn: str | None = None
    ogrn: str | None = None
    capitalization_usd: Decimal | None = None
    email: str | None = None
    phone: str | None = None
    address: AddressShort | None = None
    risk_score: float | None = None
    last_seen_at: datetime | None = None
    raw: dict[str, Any] | None = None
    field_provenance: dict[str, list[FieldProvenanceEntry]] = Field(default_factory=dict)

    # Enriched (lazy-computed on detail) — see app.services.companies
    scores: CompanyScores | None = None
    insights: list[CompanyInsight] = Field(default_factory=list)
    similar: list[CompanyListItem] = Field(default_factory=list)
    timeline_events: list[TimelineEvent] = Field(default_factory=list)
    related_tenders: list[dict[str, Any]] = Field(default_factory=list)
    data_quality: DataQuality | None = None


class CompanyCreate(BaseModel):
    bin: str | None = None
    inn: str | None = None
    country: str = Field(min_length=2, max_length=2)
    name: str
    industry_code: str | None = None
    legal_form: str | None = None


class CompanyChangeEntry(BaseModel):
    field: str
    old: Any = None
    new: Any = None
    detected_at: datetime
    source: dict[str, Any] | None = None
