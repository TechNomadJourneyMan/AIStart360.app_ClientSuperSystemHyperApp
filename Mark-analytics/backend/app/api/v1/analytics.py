"""Analytics endpoints — power the dashboard widgets."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.billing.tier import Tier, get_user_tier, require_min_tier
from app.core.deps import CurrentUserDep, OptionalUserDep, SessionDep
from app.core.errors import envelope
from app.filters.registry import parse_filters
from app.schemas.analytics import (
    AnalyticsInsightCard,
    AnalyticsOverview,
    CityDistributionItem,
    CountryDistributionItem,
    GrowthLeaderItem,
    IndustryDistributionItem,
    RegionDistributionItem,
    SizeBucketItem,
    StatusBreakdownItem,
)
from app.schemas.envelope import ResponseEnvelope
from app.services import analytics

router = APIRouter()


async def _require_starter(user: CurrentUserDep) -> None:
    """Helper: 402 if user is below STARTER."""
    tier = await get_user_tier(user)
    require_min_tier(tier, Tier.STARTER)


@router.get(
    "/overview",
    summary="Top-line KPIs under current filters",
    response_model=ResponseEnvelope[AnalyticsOverview],
)
async def overview(
    request: Request, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    filters = parse_filters(dict(request.query_params))
    data = await analytics.overview(session, filters=filters)
    return envelope(data=data, meta={"filters_applied": list(filters.keys())})


@router.get(
    "/industry-distribution",
    summary="Top industries by companies + revenue",
    response_model=ResponseEnvelope[list[IndustryDistributionItem]],
)
async def industry_distribution(
    request: Request, session: SessionDep, _user: OptionalUserDep = None, limit: int = 10,
) -> dict[str, Any]:
    filters = parse_filters(dict(request.query_params))
    data = await analytics.industry_distribution(session, filters=filters, limit=limit)
    return envelope(data=data)


@router.get(
    "/country-distribution",
    summary="Companies + revenue by country",
    response_model=ResponseEnvelope[list[CountryDistributionItem]],
)
async def country_distribution(
    request: Request, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    filters = parse_filters(dict(request.query_params))
    data = await analytics.country_distribution(session, filters=filters)
    return envelope(data=data)


@router.get(
    "/growth-leaders",
    summary="Top companies by revenue",
    response_model=ResponseEnvelope[list[GrowthLeaderItem]],
)
async def growth_leaders(
    request: Request, session: SessionDep, _user: OptionalUserDep = None, limit: int = 10,
) -> dict[str, Any]:
    filters = parse_filters(dict(request.query_params))
    data = await analytics.growth_leaders(session, filters=filters, limit=limit)
    return envelope(data=data)


@router.get(
    "/size-distribution",
    summary="Buckets: micro/small/medium/large/enterprise",
    response_model=ResponseEnvelope[list[SizeBucketItem]],
)
async def size_distribution(
    request: Request, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    filters = parse_filters(dict(request.query_params))
    data = await analytics.size_distribution(session, filters=filters)
    return envelope(data=data)


@router.get(
    "/status-breakdown",
    summary="Companies grouped by status",
    response_model=ResponseEnvelope[list[StatusBreakdownItem]],
)
async def status_breakdown(
    request: Request, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    filters = parse_filters(dict(request.query_params))
    data = await analytics.status_breakdown(session, filters=filters)
    return envelope(data=data)


_ALLOWED_METRICS = {"count", "revenue", "employees"}


@router.get(
    "/region-distribution",
    summary="Companies grouped by region (KATO + name)",
    response_model=ResponseEnvelope[list[RegionDistributionItem]],
)
async def region_distribution(
    request: Request,
    session: SessionDep,
    _user: OptionalUserDep = None,
    country: str = "KZ",
    metric: str = "count",
) -> dict[str, Any]:
    # DEV: tier gate disabled while in development.
    # await _require_starter(user)
    if metric not in _ALLOWED_METRICS:
        metric = "count"
    raw = {k: v for k, v in request.query_params.items() if k not in {"country", "metric"}}
    filters = parse_filters(raw)
    data = await analytics.region_distribution(
        session, filters=filters, country=country, metric=metric,
    )
    return envelope(
        data=data,
        meta={"country": country, "metric": metric, "filters_applied": list(filters.keys())},
    )


@router.get(
    "/city-distribution",
    summary="Top-N cities by selected metric",
    response_model=ResponseEnvelope[list[CityDistributionItem]],
)
async def city_distribution(
    request: Request,
    session: SessionDep,
    _user: OptionalUserDep = None,
    country: str = "KZ",
    metric: str = "count",
    limit: int = 20,
) -> dict[str, Any]:
    # DEV: tier gate disabled while in development.
    # await _require_starter(user)
    if metric not in _ALLOWED_METRICS:
        metric = "count"
    limit = max(1, min(limit, 200))
    raw = {
        k: v for k, v in request.query_params.items() if k not in {"country", "metric", "limit"}
    }
    filters = parse_filters(raw)
    data = await analytics.city_distribution(
        session, filters=filters, country=country, metric=metric, limit=limit,
    )
    return envelope(
        data=data,
        meta={
            "country": country,
            "metric": metric,
            "limit": limit,
            "filters_applied": list(filters.keys()),
        },
    )


@router.get(
    "/insights",
    summary="Rule-based market insight cards (AI optional)",
    response_model=ResponseEnvelope[list[AnalyticsInsightCard]],
)
async def insights(
    request: Request, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    # DEV: tier gate disabled while in development.
    # await _require_starter(user)
    filters = parse_filters(dict(request.query_params))
    ov = await analytics.overview(session, filters=filters)
    industries = await analytics.industry_distribution(session, filters=filters, limit=10)
    countries = await analytics.country_distribution(session, filters=filters)
    sizes = await analytics.size_distribution(session, filters=filters)
    cards = analytics.generate_insights(ov, industries, countries, sizes)
    return envelope(data=cards)


