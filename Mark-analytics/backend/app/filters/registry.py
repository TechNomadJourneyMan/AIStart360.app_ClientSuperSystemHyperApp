"""Filter taxonomy registry — see docs/aistart360/01-filter-taxonomy.md.

Single source of truth for what query params are accepted, their types,
allowed values, and how they translate into SQL.

Used by:
  - Companies/Tenders/Persons list endpoints
  - Search service
  - Trends/Forecasts that take filter inputs
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.core.errors import ValidationError


class FilterType(StrEnum):
    ENUM = "enum"
    MULTI_ENUM = "multi_enum"
    MULTI_TEXT = "multi_text"
    RANGE_NUMBER = "range_number"
    RANGE_DATE = "range_date"
    BOOL = "bool"
    TEXT = "text"
    COMPOSITE = "composite"


@dataclass(frozen=True, slots=True)
class FilterDef:
    key: str
    type: FilterType
    backed_by: str                                # SQL column or derived expression
    values: tuple[str, ...] | None = None         # allowed values for enum/multi_enum
    description: str = ""
    public_in_facets: bool = True


# Compact registry — full taxonomy in docs/aistart360/01-filter-taxonomy.md
FILTERS: dict[str, FilterDef] = {f.key: f for f in [
    # Geography
    FilterDef("country", FilterType.MULTI_ENUM, "companies.country",
              values=("KZ", "RU", "UZ", "KG", "TJ", "BY", "AM", "AZ", "GE")),
    FilterDef("region", FilterType.MULTI_TEXT, "companies.region_name",
              description="Регион / область (по денормализованному названию)"),
    FilterDef("region_name", FilterType.MULTI_TEXT, "companies.region_name",
              description="Регион / область (alias)"),
    FilterDef("region_kato", FilterType.MULTI_TEXT, "companies.region_kato",
              description="Регион (KATO)"),
    FilterDef("city", FilterType.MULTI_TEXT, "companies.city_name",
              description="Город (по денормализованному названию)"),
    FilterDef("city_name", FilterType.MULTI_TEXT, "companies.city_name",
              description="Город (alias)"),

    # Industry
    FilterDef("industry", FilterType.MULTI_ENUM, "companies.industry_code", values=None),
    FilterDef("sub_industry", FilterType.MULTI_ENUM, "companies.industry_code"),
    FilterDef("niche_tags", FilterType.MULTI_TEXT, "companies.tags"),

    # Size / maturity
    FilterDef("company_size", FilterType.ENUM, "derived",
              values=("micro", "small", "medium", "large", "enterprise")),
    FilterDef("employee_count", FilterType.RANGE_NUMBER, "companies.employee_count"),
    FilterDef("revenue_usd", FilterType.RANGE_NUMBER, "companies.revenue_usd"),
    FilterDef("business_age_years", FilterType.RANGE_NUMBER, "derived:registered_at"),
    FilterDef("growth_rate_pct", FilterType.RANGE_NUMBER, "derived:revenue_yoy"),
    FilterDef("profitability", FilterType.ENUM, "derived",
              values=("unknown", "loss", "low", "healthy", "high")),

    # Legal
    FilterDef("legal_form", FilterType.MULTI_ENUM, "companies.legal_form"),
    FilterDef("ownership_type", FilterType.ENUM, "derived",
              values=("private", "public", "state", "mixed", "foreign_owned")),
    FilterDef("status", FilterType.ENUM, "companies.status",
              values=("active", "liquidated", "reorganizing", "bankrupt", "suspended")),

    # Model
    FilterDef("b2_orientation", FilterType.MULTI_ENUM, "companies.tags",
              values=("B2B", "B2C", "B2G", "P2P", "D2C")),
    FilterDef("online_offline", FilterType.ENUM, "derived",
              values=("online_only", "offline_only", "hybrid")),
    FilterDef("lifecycle_stage", FilterType.ENUM, "derived",
              values=("startup", "growth", "stable", "decline", "exit", "defunct")),
    FilterDef("investment_stage", FilterType.ENUM, "derived",
              values=("bootstrap", "pre_seed", "seed", "series_a", "series_b",
                      "series_c", "growth", "late", "ipo", "post_ipo")),

    # Digital / signals
    FilterDef("digital_maturity", FilterType.RANGE_NUMBER, "derived"),
    FilterDef("ai_adoption_level", FilterType.RANGE_NUMBER, "derived"),
    FilterDef("hiring_activity", FilterType.ENUM, "derived",
              values=("none", "low", "medium", "high", "very_high")),
    FilterDef("media_presence", FilterType.ENUM, "derived",
              values=("low", "medium", "high")),
    FilterDef("sentiment", FilterType.ENUM, "derived",
              values=("negative", "mixed", "neutral", "positive")),

    # Government / risk
    FilterDef("government_participation", FilterType.ENUM, "derived",
              values=("none", "contractor", "recipient", "state_owned", "mixed")),
    FilterDef("procurement_volume_usd", FilterType.RANGE_NUMBER, "derived"),
    FilterDef("risk_level", FilterType.RANGE_NUMBER, "derived"),
    FilterDef("sanctions_flag", FilterType.BOOL, "derived"),

    # Geo composite
    FilterDef("geo_radius_km", FilterType.COMPOSITE, "derived:postgis"),
]}


def parse_filters(query_params: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize raw query params. Raises ValidationError for unknown keys."""
    out: dict[str, Any] = {}
    for raw_key, raw_value in query_params.items():
        if raw_key in {"q", "cursor", "limit", "sort", "explain", "format"}:
            continue
        negated = raw_key.endswith("!")
        key = raw_key[:-1] if negated else raw_key
        if key not in FILTERS:
            raise ValidationError(f"Unknown filter: {raw_key}", details={"key": raw_key})

        f = FILTERS[key]
        value = _parse_value(f, raw_value)
        out[raw_key] = value
    return out


def _parse_value(f: FilterDef, raw: Any) -> Any:
    if f.type in (FilterType.MULTI_ENUM, FilterType.MULTI_TEXT):
        if isinstance(raw, str):
            raw = [v.strip() for v in raw.split(",") if v.strip()]
        if f.values:
            invalid = [v for v in raw if v not in f.values]
            if invalid:
                raise ValidationError(
                    f"Invalid values for {f.key}: {invalid}. Allowed: {f.values}",
                    details={"key": f.key, "invalid": invalid},
                )
        return raw

    if f.type == FilterType.ENUM:
        if f.values and raw not in f.values:
            raise ValidationError(
                f"Invalid value for {f.key}: {raw}. Allowed: {f.values}",
                details={"key": f.key, "value": raw},
            )
        return raw

    if f.type == FilterType.BOOL:
        return str(raw).lower() in {"1", "true", "yes", "on"}

    if f.type in (FilterType.RANGE_NUMBER, FilterType.RANGE_DATE):
        # "<gte>..<lte>" form
        if isinstance(raw, str) and ".." in raw:
            lo, hi = raw.split("..", 1)
            return {"gte": _try_num(lo), "lte": _try_num(hi)}
        return raw

    return raw


def _try_num(s: str) -> float | str | None:
    s = s.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return s


def list_public_filters() -> list[dict[str, Any]]:
    """For frontend: returns filter catalog the UI can render."""
    return [
        {
            "key": f.key,
            "type": f.type.value,
            "values": list(f.values) if f.values else None,
            "description": f.description,
            "backed_by": f.backed_by,
        }
        for f in FILTERS.values() if f.public_in_facets
    ]
