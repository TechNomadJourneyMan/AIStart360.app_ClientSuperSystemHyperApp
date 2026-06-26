"""Search endpoint — Phase 0 stub.

Returns the canonical bucketed structure (companies / persons / tenders)
with empty arrays. Full hybrid search lands in Phase 6.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.core.deps import OptionalUserDep
from app.core.errors import envelope

router = APIRouter()

_SUPPORTED_TYPES = ("companies", "persons", "tenders")


def _parse_types(raw: str | None) -> list[str]:
    if not raw:
        return list(_SUPPORTED_TYPES)
    requested = [t.strip().lower() for t in raw.split(",") if t.strip()]
    return [t for t in requested if t in _SUPPORTED_TYPES] or list(_SUPPORTED_TYPES)


@router.get("", summary="Multi-entity search (stub)")
async def search(
    _user: OptionalUserDep = None,
    q: str = Query(default="", description="Query string"),
    types: str | None = Query(
        default=None,
        description="Comma-separated entity types: companies,persons,tenders",
    ),
    limit: int = Query(default=10, ge=1, le=100),
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 6.

    Returns the canonical bucketed shape so the frontend can render result
    panels even before the real search service exists. Always 200 OK.
    """
    selected = _parse_types(types)
    buckets: dict[str, list[Any]] = {t: [] for t in _SUPPORTED_TYPES if t in selected}

    return envelope(
        data=buckets,
        meta={
            "query": q,
            "total": 0,
            "types": selected,
            "limit": limit,
            "stub": True,
        },
    )
