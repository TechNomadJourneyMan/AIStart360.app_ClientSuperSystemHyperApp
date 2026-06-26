"""Trends endpoints — Phase 0 stubs.

Time-series aggregates over companies / tenders / registrations.
Returns empty series for now; full implementation in Phase 5.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.core.deps import OptionalUserDep
from app.core.errors import envelope

router = APIRouter()


@router.get("/companies-by-month", summary="Companies registered per month (stub)")
async def companies_by_month(
    _user: OptionalUserDep = None,
    country: str = Query(default="KZ", description="ISO country code"),
    industry: str | None = Query(default=None),
    months: int = Query(default=12, ge=1, le=120),
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 5."""
    return envelope(
        data=[],
        meta={
            "series": "companies_by_month",
            "country": country,
            "industry": industry,
            "months": months,
            "stub": True,
        },
    )


@router.get("/revenue-by-quarter", summary="Revenue aggregates per quarter (stub)")
async def revenue_by_quarter(
    _user: OptionalUserDep = None,
    industry: str | None = Query(default=None),
    region_kato: str | None = Query(default=None),
    quarters: int = Query(default=8, ge=1, le=40),
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 5."""
    return envelope(
        data=[],
        meta={
            "series": "revenue_by_quarter",
            "industry": industry,
            "region_kato": region_kato,
            "quarters": quarters,
            "stub": True,
        },
    )


@router.get("/registrations", summary="Registrations time-series (stub)")
async def registrations(
    _user: OptionalUserDep = None,
    region_kato: str | None = Query(default=None),
    bucket: str = Query(default="month", pattern="^(day|week|month|quarter|year)$"),
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 5."""
    return envelope(
        data=[],
        meta={
            "series": "registrations",
            "region_kato": region_kato,
            "bucket": bucket,
            "stub": True,
        },
    )
