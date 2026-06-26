"""Persons endpoints — list, detail with role_history, company → people.

Sprint 4.2 surface. List supports `q` (pg_trgm fuzzy + ILIKE fallback),
`company_id`, `country`, `role` filters and offset pagination (limit ≤ 100).
Detail aggregates role_history from the JSONB column and includes a
data_quality envelope. See `docs/10-api-contract.md` §persons.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import NotFoundError, envelope
from app.schemas.person import (
    PersonListItem,
    PersonRead,
    RoleHistoryEntry,
)
from app.services.persons import (
    compute_data_quality,
    current_roles,
    get_company_people,
    get_person,
    list_persons,
    normalize_role_history,
)

router = APIRouter()


@router.get("", summary="List persons with filters")
async def list_(
    session: SessionDep,
    _user: OptionalUserDep = None,
    q: str | None = Query(default=None, description="Fuzzy name search (pg_trgm + ILIKE)"),
    company_id: UUID | None = Query(default=None, description="Persons linked to this company"),
    country: str | None = Query(default=None, min_length=2, max_length=2),
    role: str | None = Query(default=None, description="director, founder, board_member, …"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    rows, total = await list_persons(
        session,
        q=q,
        company_id=company_id,
        country=country,
        role=role,
        limit=limit,
        offset=offset,
    )
    data = [_to_list_item(p).model_dump(mode="json") for p in rows]
    return envelope(
        data=data,
        meta={
            "total": total,
            "limit": limit,
            "offset": offset,
            "filters_received": {
                "q": q,
                "company_id": str(company_id) if company_id else None,
                "country": country,
                "role": role,
            },
        },
    )


@router.get("/{person_id}", summary="Get person detail with role_history")
async def detail(
    person_id: UUID,
    session: SessionDep,
    _user: OptionalUserDep = None,
) -> dict[str, Any]:
    row = await get_person(session, person_id)
    if row is None:
        raise NotFoundError(f"Person {person_id} not found", code="PERSON_NOT_FOUND")

    history = normalize_role_history(row.role_history)
    payload = PersonRead(
        id=row.id,
        full_name=row.full_name,
        country=row.country,
        sanctions=row.sanctions,
        updated_at=row.updated_at,
        iin=row.iin,
        contacts=row.contacts,
        role_history=history,
        current_roles=current_roles(history),
        data_quality=compute_data_quality(row),
    )
    return envelope(data=payload.model_dump(mode="json"))


def _to_list_item(p: Any) -> PersonListItem:
    return PersonListItem(
        id=p.id,
        full_name=p.full_name,
        country=p.country,
        sanctions=p.sanctions,
        updated_at=p.updated_at,
    )


# ────────────────────────────────────────────────────────────────────
# Companion endpoint — mounted on /companies via a separate router below.
# We expose it from this module so persons-related changes stay together.
# ────────────────────────────────────────────────────────────────────


companies_people_router = APIRouter()


@companies_people_router.get(
    "/{company_id}/people",
    summary="Current people at a company",
)
async def company_people(
    company_id: UUID,
    session: SessionDep,
    _user: OptionalUserDep = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    pairs = await get_company_people(session, company_id, current_only=True, limit=limit)
    data: list[dict[str, Any]] = []
    for person, entry in pairs:
        data.append(
            {
                "person_id": str(person.id),
                "full_name": person.full_name,
                "country": person.country,
                "sanctions": person.sanctions,
                **_role_entry_payload(entry),
            }
        )
    return envelope(
        data=data,
        meta={"count": len(data), "company_id": str(company_id), "current_only": True},
    )


def _role_entry_payload(entry: RoleHistoryEntry) -> dict[str, Any]:
    """Mirror the role_history item shape used in person detail."""
    return {
        "company_id": str(entry.company_id) if entry.company_id else None,
        "company_name": entry.company_name,
        "role": entry.role,
        "started_at": entry.started_at.isoformat() if entry.started_at else None,
        "ended_at": entry.ended_at.isoformat() if entry.ended_at else None,
        "source": entry.source,
    }
