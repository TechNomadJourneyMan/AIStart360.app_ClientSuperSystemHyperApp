"""Tests for `app.services.region_risk`.

Split:

* Unit tests for the degraded-subscore masking + envelope shape — no DB.
* One integration test (skipped unless Postgres is reachable) that
  exercises the materialized view end-to-end: it inserts a handful of
  companies + a sanctions hit, refreshes the MV, and asserts the score
  for a known-high-risk region lands above the score for a low-risk one.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import text

from app.services.region_risk import (
    WEIGHTS,
    RegionRiskSummary,
    detect_degraded,
    fetch_rows,
)

# ── Unit tests (no DB) ───────────────────────────────────────────────


def test_weights_sum_to_one() -> None:
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


def test_weights_match_spec() -> None:
    # Track E §5: 0.3 / 0.3 / 0.2 / 0.2
    assert WEIGHTS["liquidations_3m"] == 0.30
    assert WEIGHTS["court_cases_6m"] == 0.30
    assert WEIGHTS["sanctions_hits"] == 0.20
    assert WEIGHTS["complaints_count"] == 0.20


async def test_detect_degraded_lists_missing_tables() -> None:
    """If `court_cases` and `complaints` are absent, both keys are returned."""

    # to_regclass returns NULL for missing tables; we mock the scalar.
    def _exec_side_effect(_query: Any, params: dict[str, str]) -> Any:
        result = MagicMock()
        # Pretend everything is missing.
        result.scalar_one.return_value = False
        return result

    session = MagicMock()
    session.execute = AsyncMock(side_effect=_exec_side_effect)

    degraded = await detect_degraded(session)
    assert set(degraded) == {"court_cases_6m", "complaints_count"}


async def test_detect_degraded_empty_when_tables_present() -> None:
    session = MagicMock()
    result = MagicMock()
    result.scalar_one.return_value = True
    session.execute = AsyncMock(return_value=result)

    degraded = await detect_degraded(session)
    assert degraded == []


async def test_fetch_rows_masks_degraded_subscores() -> None:
    """When `court_cases` is missing, the corresponding subscore is null."""

    # First two execute() calls answer `_table_exists`: court_cases=False,
    # complaints=True. The third returns the MV rows.
    table_lookups = iter([False, True])

    rows_payload = [
        {
            "kato_code": "75",
            "score": 42.5,
            "subscores": {
                "liquidations_3m": 5,
                "court_cases_6m": 99,   # should be masked to None
                "sanctions_hits": 2,
                "complaints_count": 1,
            },
            "updated_at": datetime(2026, 5, 28, tzinfo=UTC),
        },
    ]

    async def fake_execute(query: Any, params: dict[str, Any] | None = None) -> Any:
        sql = str(query)
        if "to_regclass" in sql:
            r = MagicMock()
            r.scalar_one.return_value = next(table_lookups)
            return r
        if "region_risk_index" in sql:
            r = MagicMock()
            r.mappings.return_value.all.return_value = rows_payload
            return r
        raise AssertionError(f"unexpected SQL: {sql!r}")

    session = MagicMock()
    session.execute = AsyncMock(side_effect=fake_execute)

    rows, refreshed = await fetch_rows(session)

    assert len(rows) == 1
    row = rows[0]
    assert isinstance(row, RegionRiskSummary)
    assert row.kato_code == "75"
    assert row.score == pytest.approx(42.5)
    assert row.subscores["liquidations_3m"] == 5
    assert row.subscores["court_cases_6m"] is None  # masked: court_cases missing
    assert row.subscores["sanctions_hits"] == 2
    assert row.subscores["complaints_count"] == 1
    assert refreshed == datetime(2026, 5, 28, tzinfo=UTC)


# ── Integration test (real Postgres) ─────────────────────────────────


pytestmark_integration = pytest.mark.integration


@pytest.mark.integration
async def test_mv_score_is_higher_for_risky_region() -> None:
    """End-to-end: seed two regions, refresh the MV, check ordering.

    Skipped unless Postgres is reachable. The test cleans up after itself.
    """
    if not os.environ.get("MARK_TEST_DB_AVAILABLE"):
        pytest.skip("MARK_TEST_DB_AVAILABLE not set; skipping live MV test")

    from app.db.session import async_session_factory
    from app.services.region_risk import refresh_mv

    async with async_session_factory() as session:
        now = datetime.now(UTC)
        recent = now - timedelta(days=10)

        # Seed: region '90' = high risk (10 liquidations), region '91' = baseline.
        risky_ids = [uuid.uuid4() for _ in range(10)]
        baseline_ids = [uuid.uuid4() for _ in range(10)]

        try:
            for cid in risky_ids:
                await session.execute(
                    text(
                        "INSERT INTO companies "
                        "(id, country, name, name_normalized, status, region_kato, updated_at) "
                        "VALUES (:id, 'KZ', :n, :n, 'liquidated', '90', :u)"
                    ),
                    {"id": cid, "n": f"risky-{cid}", "u": recent},
                )
            for cid in baseline_ids:
                await session.execute(
                    text(
                        "INSERT INTO companies "
                        "(id, country, name, name_normalized, status, region_kato, updated_at) "
                        "VALUES (:id, 'KZ', :n, :n, 'active', '91', :u)"
                    ),
                    {"id": cid, "n": f"baseline-{cid}", "u": recent},
                )
            await session.commit()

            await refresh_mv(session, concurrently=False)

            rows, _ = await fetch_rows(session)
            by_kato = {r.kato_code: r for r in rows}
            assert "90" in by_kato and "91" in by_kato
            assert by_kato["90"].score > by_kato["91"].score
            assert 0 <= by_kato["90"].score <= 100
            assert 0 <= by_kato["91"].score <= 100
        finally:
            await session.execute(
                text("DELETE FROM companies WHERE id = ANY(:ids)"),
                {"ids": risky_ids + baseline_ids},
            )
            await session.commit()
