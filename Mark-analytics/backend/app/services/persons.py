"""Persons service — list, detail, and company-people queries.

The schema stores per-person role history as JSONB on `persons.role_history`,
shaped like `[{company_id, company_name, role, started_at, ended_at, source}, ...]`.
This module normalises that into typed `RoleHistoryEntry` objects and supplies
filtering for the API layer.

Fuzzy search uses pg_trgm (`name_normalized %% :q`) — the extension is created
in migration 0001. The `ILIKE` fallback path is left intact for safety should
the extension be absent in a downstream environment.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.person import Person
from app.schemas.person import DataQuality, RoleHistoryEntry

# Fields used to compute the person-level data_quality completeness score.
# Kept tiny on purpose — `data_quality` should be cheap to evaluate inline.
_QUALITY_FIELDS: tuple[str, ...] = ("full_name", "country", "iin", "contacts")


# ────────────────────────────────────────────────────────────────────
# List / detail / by-company
# ────────────────────────────────────────────────────────────────────


async def list_persons(
    session: AsyncSession,
    *,
    q: str | None = None,
    company_id: UUID | None = None,
    country: str | None = None,
    role: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[Person], int]:
    """Return `(rows, total)` for the persons list with filters applied.

    Fuzzy search uses pg_trgm similarity over `name_normalized` (extension is
    enabled in migration 0001). Real similarity ranking is a Phase-3 follow-up
    once we wire a GIN index — for now we just gate with `%%` and order by
    `updated_at desc`.
    """
    stmt = select(Person)

    if q:
        q_clean = q.strip()
        if q_clean:
            q_lower = q_clean.lower()
            # pg_trgm fuzzy match OR ILIKE — the OR keeps short queries (< 3
            # chars, below pg_trgm's default threshold) usable.
            stmt = stmt.where(
                or_(
                    text("persons.name_normalized %% :q").bindparams(q=q_lower),
                    Person.name_normalized.ilike(f"%{q_lower}%"),
                )
            )

    if country:
        stmt = stmt.where(Person.country == country.upper())

    if company_id is not None:
        # JSONB containment: role_history @> '[{"company_id": "<id>"}]'
        stmt = stmt.where(
            text(
                "persons.role_history @> jsonb_build_array("
                "jsonb_build_object('company_id', cast(:cid as text)))"
            ).bindparams(cid=str(company_id))
        )

    if role:
        stmt = stmt.where(
            text(
                "persons.role_history @> jsonb_build_array("
                "jsonb_build_object('role', :role))"
            ).bindparams(role=role)
        )

    # Cheap exact count over the same filter set — persons list is small enough
    # to count without estimating.
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await session.execute(count_stmt)).scalar() or 0

    stmt = (
        stmt.order_by(Person.updated_at.desc(), Person.id.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return rows, total


async def get_person(session: AsyncSession, person_id: UUID) -> Person | None:
    """Single Person row by id, or None if missing."""
    return await session.get(Person, person_id)


async def get_company_people(
    session: AsyncSession,
    company_id: UUID,
    *,
    current_only: bool = True,
    limit: int = 50,
) -> list[tuple[Person, RoleHistoryEntry]]:
    """Return persons linked to `company_id` paired with the matching role entry.

    Only the *first* matching role per person is returned (one row per person
    per company). When `current_only` is True, we keep entries where
    `ended_at` is null.
    """
    stmt = (
        select(Person)
        .where(
            text(
                "persons.role_history @> jsonb_build_array("
                "jsonb_build_object('company_id', cast(:cid as text)))"
            ).bindparams(cid=str(company_id))
        )
        .order_by(Person.updated_at.desc())
        .limit(limit)
    )
    rows = list((await session.execute(stmt)).scalars().all())

    paired: list[tuple[Person, RoleHistoryEntry]] = []
    for p in rows:
        entry = _pick_role_for_company(p, company_id, current_only=current_only)
        if entry is None:
            continue
        paired.append((p, entry))
    return paired


# ────────────────────────────────────────────────────────────────────
# Pure helpers (no DB)
# ────────────────────────────────────────────────────────────────────


def normalize_role_history(raw: list[dict[str, Any]] | None) -> list[RoleHistoryEntry]:
    """Coerce JSONB role_history into a sorted list of `RoleHistoryEntry`.

    Sort key: `started_at desc` with nulls last, then `company_name asc` for
    a stable tie-break. Invalid entries (non-dicts) are silently skipped.
    """
    if not raw:
        return []
    entries: list[RoleHistoryEntry] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            entries.append(RoleHistoryEntry.model_validate(item))
        except Exception:  # noqa: S112 — defensive: bad JSONB shouldn't 500 the API
            continue

    def _sort_key(e: RoleHistoryEntry) -> tuple[int, date, str]:
        # nulls last → (1, date.min, name) ; non-null → (0, -started_at)
        if e.started_at is None:
            return (1, date.min, (e.company_name or "").lower())
        # Negate via swap: build a comparable tuple where later dates come first.
        return (0, e.started_at, (e.company_name or "").lower())

    entries.sort(key=_sort_key, reverse=False)
    # Two-pass: reverse only the date-bearing chunk so nulls stay at the end.
    dated = [e for e in entries if e.started_at is not None]
    undated = [e for e in entries if e.started_at is None]
    dated.sort(
        key=lambda e: (e.started_at or date.min, (e.company_name or "").lower()),
        reverse=True,
    )
    return [*dated, *undated]


def current_roles(entries: list[RoleHistoryEntry]) -> list[RoleHistoryEntry]:
    """Subset of role_history with `ended_at is None`."""
    return [e for e in entries if e.ended_at is None]


def _pick_role_for_company(
    person: Person,
    company_id: UUID,
    *,
    current_only: bool,
) -> RoleHistoryEntry | None:
    """Find the matching role entry for `company_id` on `person.role_history`."""
    entries = normalize_role_history(person.role_history)
    cid = str(company_id)
    matching = [e for e in entries if str(e.company_id) == cid]
    if current_only:
        matching = [e for e in matching if e.ended_at is None]
    if not matching:
        return None
    # Most-recent first thanks to `normalize_role_history` ordering.
    return matching[0]


def compute_data_quality(person: Person) -> DataQuality:
    """Cheap inline completeness score over `_QUALITY_FIELDS`.

    Matches the `Track C1` envelope shape: a 0..1 completeness ratio plus the
    list of fields that were null/empty. When `compute_data_quality` from
    that track lands properly, this function is a one-line swap.
    """
    missing: list[str] = []
    for field in _QUALITY_FIELDS:
        value = getattr(person, field, None)
        if value is None or value == "" or value == {}:
            missing.append(field)
    completeness = 1.0 - (len(missing) / len(_QUALITY_FIELDS))
    return DataQuality(completeness=round(completeness, 4), missing_fields=missing)


# Silence the F401 imports we keep around for future migrations to columns.
_ = (cast, String, datetime)
