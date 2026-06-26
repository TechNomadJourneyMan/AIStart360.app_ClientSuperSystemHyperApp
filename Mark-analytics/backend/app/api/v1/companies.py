"""Companies endpoints — list, detail, and detail sub-resources."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, Request

from app.billing.quota import check_and_increment
from app.billing.tier import get_user_tier
from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import NotFoundError, envelope
from app.filters.registry import parse_filters
from app.models.company import Company
from app.schemas.analytics import CompanyInsightsBundle
from app.schemas.company import (
    CompanyDetail,
    CompanyInsight,
    CompanyListItem,
    CompanyScores,
    DataQuality,
    IndustryRef,
    TimelineEvent,
)
from app.schemas.envelope import ResponseEnvelope
from app.services.companies import (
    compute_data_quality,
    get_company_by_id,
    get_insights_cached,
    get_similar,
    get_timeline,
    list_companies,
)
from app.workers.tasks.egov_enrich import enqueue_egov_enrich_if_needed

router = APIRouter()


@router.get(
    "",
    summary="List companies with filters",
    response_model=ResponseEnvelope[list[CompanyListItem]],
)
async def list_(
    request: Request,
    session: SessionDep,
    _user: OptionalUserDep = None,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    raw = dict(request.query_params)
    filters = parse_filters(raw)

    # DEV: quota disabled while in development.
    # if _user is not None:
    #     tier = await get_user_tier(_user)
    #     await check_and_increment(_user.user_id, tier, "searches")

    rows, next_cursor, total = await list_companies(
        session, filters=filters, q=q, limit=limit, cursor=cursor,
    )

    data = [_to_list_item(r).model_dump(mode="json") for r in rows]
    return envelope(
        data=data,
        meta={
            "page": {"cursor_next": next_cursor, "limit": limit, "total_estimate": total},
            "filters_applied": list(filters.keys()),
        },
    )


@router.get(
    "/{company_id}",
    summary="Get enriched company detail",
    response_model=ResponseEnvelope[CompanyDetail],
)
async def detail(
    company_id: UUID, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    row = await _require_company(session, company_id)

    # DEV: quota disabled while in development.
    # if _user is not None:
    #     tier = await get_user_tier(_user)
    #     await check_and_increment(_user.user_id, tier, "profiles")

    # PR #8: on-demand egov.kz enrichment for KZ companies missing director info.
    # Fire-and-forget: never blocks the response, swallows its own errors.
    user_id = _user.user_id if _user is not None else None
    tier = _user.app_metadata.get("plan", "free") if _user is not None else "free"
    await enqueue_egov_enrich_if_needed(row, user_id=user_id, tier=tier)

    # Cached: scores + insights + related tenders (Q1 + Q3, plus formulas).
    scores, insights, related_tenders = await get_insights_cached(session, row)
    # Q2: timeline rows from companies_changes.
    timeline_rows = await get_timeline(session, company_id)
    # Q4: similar companies.
    similar_rows = await get_similar(session, company_id, limit=5)

    timeline = _merge_timeline(row, timeline_rows, related_tenders)
    data_quality = await compute_data_quality(session, row)

    detail_obj = _to_detail(
        row,
        scores=scores,
        insights=insights,
        similar=[_to_list_item(c) for c in similar_rows],
        timeline_events=timeline,
        related_tenders=related_tenders,
        data_quality=data_quality,
    )
    return envelope(data=detail_obj.model_dump(mode="json"))


@router.get(
    "/{company_id}/similar",
    summary="Companies similar to {id}",
    response_model=ResponseEnvelope[list[CompanyListItem]],
)
async def similar(
    company_id: UUID,
    session: SessionDep,
    _user: OptionalUserDep = None,
    limit: int = Query(default=5, ge=1, le=20),
) -> dict[str, Any]:
    await _require_company(session, company_id)
    rows = await get_similar(session, company_id, limit=limit)
    data = [_to_list_item(c).model_dump(mode="json") for c in rows]
    return envelope(data=data, meta={"limit": limit, "count": len(data)})


@router.get(
    "/{company_id}/timeline",
    summary="Company timeline",
    response_model=ResponseEnvelope[list[TimelineEvent]],
)
async def timeline(
    company_id: UUID, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    row = await _require_company(session, company_id)
    related = await get_insights_cached(session, row)
    _scores, _insights, related_tenders = related
    timeline_rows = await get_timeline(session, company_id)
    events = _merge_timeline(row, timeline_rows, related_tenders)
    data = [e.model_dump(mode="json") for e in events]
    return envelope(data=data, meta={"count": len(data)})


@router.get(
    "/{company_id}/insights",
    summary="Insight cards + scores (cached)",
    response_model=ResponseEnvelope[CompanyInsightsBundle],
)
async def insights(
    company_id: UUID, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    row = await _require_company(session, company_id)
    scores, insight_cards, _ = await get_insights_cached(session, row)
    return envelope(
        data={
            "scores": scores.model_dump(mode="json"),
            "insights": [i.model_dump(mode="json") for i in insight_cards],
        },
        meta={"cached": True, "ttl_seconds": 3600},
    )


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


async def _require_company(session: SessionDep, company_id: UUID) -> Company:
    row = await get_company_by_id(session, company_id)
    if not row:
        raise NotFoundError(f"Company {company_id} not found", code="COMPANY_NOT_FOUND")
    return row


def _to_list_item(c: Any) -> CompanyListItem:
    industry = IndustryRef(code=c.industry_code, label=c.industry_label) \
        if c.industry_code or c.industry_label else None
    return CompanyListItem(
        id=c.id, bin=c.bin, name=c.name, country=c.country,
        legal_form=c.legal_form, status=c.status,
        industry=industry, registered_at=c.registered_at,
        employee_count=c.employee_count, revenue_usd=c.revenue_usd,
        website=c.website, tags=c.tags, confidence=float(c.confidence) if c.confidence else None,
        updated_at=c.updated_at,
        size_category=getattr(c, "size_category", None),
        ownership_type_detail=getattr(c, "ownership_type_detail", None),
        kato_code=getattr(c, "kato_code", None),
        data_source=getattr(c, "data_source", None),
    )


def _to_detail(
    c: Any,
    *,
    scores: CompanyScores | None = None,
    insights: list[CompanyInsight] | None = None,
    similar: list[CompanyListItem] | None = None,
    timeline_events: list[TimelineEvent] | None = None,
    related_tenders: list[dict[str, Any]] | None = None,
    data_quality: DataQuality | None = None,
) -> CompanyDetail:
    base = _to_list_item(c).model_dump()
    return CompanyDetail(
        **base,
        description=c.description, inn=c.inn, ogrn=c.ogrn,
        capitalization_usd=c.capitalization_usd, email=c.email, phone=c.phone,
        risk_score=float(c.risk_score) if c.risk_score else None,
        last_seen_at=c.last_seen_at, raw=c.raw,
        scores=scores,
        insights=insights or [],
        similar=similar or [],
        timeline_events=timeline_events or [],
        related_tenders=related_tenders or [],
        data_quality=data_quality,
    )


def _merge_timeline(
    company: Company,
    change_events: list[TimelineEvent],
    related_tenders: list[dict[str, Any]],
) -> list[TimelineEvent]:
    """Combine companies_changes + lifecycle dates + recent tenders → sorted desc."""
    from datetime import datetime, time, timezone

    merged: list[TimelineEvent] = list(change_events)

    if company.registered_at:
        merged.append(TimelineEvent(
            at=datetime.combine(company.registered_at, time.min, tzinfo=timezone.utc),
            kind="registered",
            label="Компания зарегистрирована",
            payload={"date": company.registered_at.isoformat()},
        ))
    if company.updated_at:
        upd = company.updated_at
        if upd.tzinfo is None:
            upd = upd.replace(tzinfo=timezone.utc)
        merged.append(TimelineEvent(
            at=upd,
            kind="updated",
            label="Профиль обновлён",
            payload={},
        ))

    for t in related_tenders[:5]:
        if not t.get("published_at"):
            continue
        try:
            at = datetime.fromisoformat(t["published_at"])
        except ValueError:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        merged.append(TimelineEvent(
            at=at,
            kind="tender",
            label=f"Тендер: {t['title'][:80]}",
            payload={"role": t.get("role"), "amount_usd": t.get("amount_usd"),
                     "tender_id": t.get("id"), "status": t.get("status")},
        ))

    merged.sort(key=lambda e: e.at, reverse=True)
    return merged
