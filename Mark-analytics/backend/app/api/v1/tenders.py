"""Tenders endpoints — real DB-backed reads.

`/recent` is the primary consumer (used by the dashboard ticker widget).
`/` list supports filtered cursor pagination consistent with the companies
router (cursor ordered by published_at DESC, id DESC).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import aliased

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import NotFoundError, envelope
from app.models.company import Company
from app.models.tender import Tender
from app.schemas.pagination import decode_cursor, encode_cursor

router = APIRouter()


@router.get("", summary="List tenders with filters")
async def list_tenders(
    session: SessionDep,
    _user: OptionalUserDep = None,
    status: str | None = Query(default=None),
    customer_id: UUID | None = Query(default=None),
    awarded_to_id: UUID | None = Query(default=None),
    source: str | None = Query(default=None),
    q: str | None = Query(default=None, description="ILIKE match on tender title"),
    min_amount_usd: Decimal | None = Query(default=None, ge=0),
    max_amount_usd: Decimal | None = Query(default=None, ge=0),
    published_from: datetime | None = Query(default=None),
    published_to: datetime | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    """Filtered, cursor-paginated tender list.

    Ordered by `published_at DESC NULLS LAST, id DESC`. The cursor encodes
    `(published_at, id)` — same scheme as the companies router. Rows with a
    NULL `published_at` are not given a forward cursor (they sort to the tail);
    callers paginate the dated rows first.
    """
    customer = aliased(Company)
    stmt = (
        select(
            Tender.id,
            Tender.title,
            Tender.amount_usd,
            Tender.currency,
            Tender.status,
            Tender.published_at,
            Tender.deadline_at,
            Tender.source,
            Tender.external_id,
            Tender.customer_id,
            Tender.awarded_to_id,
            customer.name.label("customer_name"),
        )
        .select_from(Tender)
        .join(customer, Tender.customer_id == customer.id, isouter=True)
    )

    applied: list[str] = []
    if status is not None:
        stmt = stmt.where(Tender.status == status)
        applied.append("status")
    if customer_id is not None:
        stmt = stmt.where(Tender.customer_id == customer_id)
        applied.append("customer_id")
    if awarded_to_id is not None:
        stmt = stmt.where(Tender.awarded_to_id == awarded_to_id)
        applied.append("awarded_to_id")
    if source is not None:
        stmt = stmt.where(Tender.source == source)
        applied.append("source")
    if q:
        stmt = stmt.where(Tender.title.ilike(f"%{q}%"))
        applied.append("q")
    if min_amount_usd is not None:
        stmt = stmt.where(Tender.amount_usd >= min_amount_usd)
        applied.append("min_amount_usd")
    if max_amount_usd is not None:
        stmt = stmt.where(Tender.amount_usd <= max_amount_usd)
        applied.append("max_amount_usd")
    if published_from is not None:
        stmt = stmt.where(Tender.published_at >= published_from)
        applied.append("published_from")
    if published_to is not None:
        stmt = stmt.where(Tender.published_at <= published_to)
        applied.append("published_to")

    if cursor:
        cur_ts, cur_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Tender.published_at < cur_ts,
                and_(Tender.published_at == cur_ts, Tender.id < cur_id),
            )
        )

    stmt = stmt.order_by(
        Tender.published_at.desc().nulls_last(), Tender.id.desc()
    ).limit(limit + 1)

    rows = (await session.execute(stmt)).all()

    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        if last.published_at is not None:
            next_cursor = encode_cursor(last.published_at, last.id)
        rows = rows[:limit]

    items = [
        {
            "id": str(r.id),
            "title": r.title,
            "amount": float(r.amount_usd) if r.amount_usd is not None else None,
            "currency": r.currency,
            "status": r.status,
            "customer": r.customer_name,
            "customer_id": str(r.customer_id) if r.customer_id else None,
            "awarded_to_id": str(r.awarded_to_id) if r.awarded_to_id else None,
            "deadline": r.deadline_at.isoformat() if r.deadline_at else None,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "source": r.source,
            "source_url": _source_url(r.source, r.external_id),
        }
        for r in rows
    ]
    return envelope(
        data=items,
        meta={
            "page": {"cursor_next": next_cursor, "limit": limit, "total_estimate": None},
            "filters_applied": applied,
            "empty": len(items) == 0,
        },
    )


@router.get("/recent", summary="Most recently published tenders")
async def recent_tenders(
    session: SessionDep,
    _user: OptionalUserDep = None,
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    """Return the N most recently published tenders, customer name joined."""
    customer = aliased(Company)
    stmt = (
        select(
            Tender.id,
            Tender.title,
            Tender.amount_usd,
            Tender.currency,
            Tender.status,
            Tender.published_at,
            Tender.deadline_at,
            Tender.source,
            Tender.external_id,
            customer.name.label("customer_name"),
        )
        .select_from(Tender)
        .join(customer, Tender.customer_id == customer.id, isouter=True)
        .order_by(Tender.published_at.desc().nulls_last(), Tender.id.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    items = [
        {
            "id": str(r.id),
            "title": r.title,
            "amount": float(r.amount_usd) if r.amount_usd is not None else None,
            "currency": r.currency,
            "status": r.status,
            "customer": r.customer_name,
            "deadline": r.deadline_at.isoformat() if r.deadline_at else None,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "source": r.source,
            "source_url": _source_url(r.source, r.external_id),
        }
        for r in rows
    ]
    return envelope(
        data=items,
        meta={"total": len(items), "limit": limit, "empty": len(items) == 0},
    )


@router.get("/{tender_id}", summary="Get tender detail (stub)")
async def tender_detail(
    tender_id: UUID,
    _user: OptionalUserDep = None,
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 3."""
    raise NotFoundError(
        f"Tender {tender_id} lookup is not implemented yet (Phase 0 stub)",
        code="NOT_IMPLEMENTED",
        status_code=404,
        details={"tender_id": str(tender_id), "phase": "0"},
    )


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


def _source_url(source: str | None, external_id: str | None) -> str | None:
    """Best-effort deep-link to the source registry for a tender.

    Only known KZ procurement sources are handled; unknown sources return None
    so the frontend falls back to a plain title (no link).
    """
    if not source or not external_id:
        return None
    s = source.lower()
    if s in {"goszakup", "goszakup.gov.kz"}:
        return f"https://goszakup.gov.kz/ru/announce/index/{external_id}"
    if s in {"samruk", "samruk-kazyna", "samruk.kz"}:
        return f"https://www.sk.kz/procurement/{external_id}"
    if s == "demo_seed":
        return None
    return None
