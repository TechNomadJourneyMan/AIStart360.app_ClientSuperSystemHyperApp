"""Region-scoped endpoints.

Currently exposes a single endpoint:

  GET /regions/risk → composite per-region risk index, with subscore breakdown.

Region GeoJSON and per-region company aggregates live under `/geo/*` for
historical reasons.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import envelope
from app.services.region_risk import detect_degraded, fetch_rows

router = APIRouter()


@router.get("/risk", summary="KZ region composite risk index")
async def regions_risk(
    session: SessionDep,
    _user: OptionalUserDep = None,
) -> dict[str, Any]:
    """Return one row per region (KATO two-digit prefix) sorted by `kato_code`.

    The composite `score` is a weighted average of four normalised
    subscores. When a backing table for a subscore is not yet present,
    that subscore is returned as `null` and the field is listed in
    `meta.degraded` so the frontend can show "—" instead of "0".
    """
    rows, refreshed_at = await fetch_rows(session)
    degraded = await detect_degraded(session)

    data = [
        {
            "kato_code": r.kato_code,
            "score": r.score,
            "subscores": r.subscores,
            "updated_at": r.updated_at.isoformat(),
        }
        for r in rows
    ]
    meta: dict[str, Any] = {
        "refreshed_at": (refreshed_at or datetime.now(UTC)).isoformat(),
        "count": len(data),
        "degraded": degraded,
        "weights": {
            "liquidations_3m":  0.30,
            "court_cases_6m":   0.30,
            "sanctions_hits":   0.20,
            "complaints_count": 0.20,
        },
    }
    return envelope(data=data, meta=meta)
