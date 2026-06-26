"""Service layer for the KZ region risk index.

Responsibilities:

* Detect which optional source tables (`court_cases`, `complaints`) are
  present so the API can surface "degraded" subscores explicitly.
* Refresh the `region_risk_index` materialized view.
* Read the MV back into a typed list of rows.

All functions take an `AsyncSession` as their first argument and return
plain dict / list payloads — the router does the envelope wrapping.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ── Subscore weights ─────────────────────────────────────────────────
# Order matches the API response keys. Must sum to 1.0.
WEIGHTS: dict[str, float] = {
    "liquidations_3m":  0.30,
    "court_cases_6m":   0.30,
    "sanctions_hits":   0.20,
    "complaints_count": 0.20,
}

# Optional tables — when absent we mark the corresponding subscore as
# degraded (null in the response payload) instead of pretending it's 0.
_OPTIONAL_TABLE_FOR_SUBSCORE: dict[str, str] = {
    "court_cases_6m":   "court_cases",
    "complaints_count": "complaints",
}


@dataclass(slots=True, frozen=True)
class RegionRiskSummary:
    """In-memory representation of one MV row, post-degradation handling."""

    kato_code: str
    score: float
    subscores: dict[str, int | None]
    updated_at: datetime


async def _table_exists(session: AsyncSession, name: str) -> bool:
    row = (await session.execute(
        text("SELECT to_regclass(:n) IS NOT NULL"),
        {"n": name},
    )).scalar_one()
    return bool(row)


async def detect_degraded(session: AsyncSession) -> list[str]:
    """Return the subscore keys whose backing table is missing."""
    degraded: list[str] = []
    for subscore, table in _OPTIONAL_TABLE_FOR_SUBSCORE.items():
        if not await _table_exists(session, table):
            degraded.append(subscore)
    return degraded


async def refresh_mv(session: AsyncSession, *, concurrently: bool = True) -> None:
    """REFRESH MATERIALIZED VIEW.

    Uses CONCURRENTLY by default (requires the unique index from migration
    0006). Falls back to the blocking refresh if CONCURRENTLY fails (e.g.
    first-ever populate, where CONCURRENTLY is not allowed).
    """
    if concurrently:
        try:
            await session.execute(
                text("REFRESH MATERIALIZED VIEW CONCURRENTLY region_risk_index")
            )
            await session.commit()
            return
        except Exception:
            await session.rollback()
    await session.execute(text("REFRESH MATERIALIZED VIEW region_risk_index"))
    await session.commit()


async def fetch_rows(session: AsyncSession) -> tuple[list[RegionRiskSummary], datetime | None]:
    """Read all rows from the MV, applying degraded-subscore masking.

    Returns (rows, refreshed_at) where `refreshed_at` is the MAX(updated_at)
    across the MV. `None` if the MV is empty.
    """
    degraded = set(await detect_degraded(session))

    result = await session.execute(
        text(
            "SELECT kato_code, score, subscores, updated_at "
            "FROM region_risk_index "
            "ORDER BY kato_code"
        )
    )
    rows = result.mappings().all()

    refreshed_at: datetime | None = None
    out: list[RegionRiskSummary] = []
    for r in rows:
        # Subscores arrive as dict from JSONB. Mask degraded ones.
        sub_raw: dict[str, Any] = dict(r["subscores"] or {})
        masked: dict[str, int | None] = {}
        for key in WEIGHTS:
            if key in degraded:
                masked[key] = None
            else:
                v = sub_raw.get(key)
                masked[key] = int(v) if v is not None else 0
        updated = r["updated_at"]
        if (updated is not None and refreshed_at is None) or (
            updated is not None and refreshed_at is not None and updated > refreshed_at
        ):
            refreshed_at = updated
        out.append(
            RegionRiskSummary(
                kato_code=str(r["kato_code"]),
                score=float(r["score"]),
                subscores=masked,
                updated_at=updated or datetime.now(UTC),
            )
        )
    return out, refreshed_at


__all__ = [
    "WEIGHTS",
    "RegionRiskSummary",
    "detect_degraded",
    "fetch_rows",
    "refresh_mv",
]
