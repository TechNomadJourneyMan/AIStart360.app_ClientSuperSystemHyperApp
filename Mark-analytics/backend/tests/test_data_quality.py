"""Unit tests for the `data_quality` envelope (§11 PR #5).

Pure-Python — no DB required. The async `_count_recent_changes` query is
stubbed via monkeypatch. Cyrillic strings in fixtures trigger the RUF001
"ambiguous character" warning; we silence it file-wide since the data is
intentionally Russian.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import companies as svc


def _fake_company(**overrides: Any) -> SimpleNamespace:
    """A Company-shaped duck. Only the columns `compute_data_quality` reads."""
    base: dict[str, Any] = dict(
        id=uuid.uuid4(),
        name="ТОО Демо",
        bin="123456789012",
        industry_code="6201",
        status="active",
        address_id=uuid.uuid4(),
        directors=[{"name": "Иванов И.И.", "role": "CEO"}],
        phone="+7-700-000-0000",
        website="https://demo.kz",
        city_name="Алматы",
        confidence_band="high",
        data_freshness_at=datetime.now(UTC) - timedelta(days=3),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _StubSession:
    """Minimal async-session stand-in: returns a configured scalar count."""

    def __init__(self, count: int) -> None:
        self._count = count

    async def execute(self, _stmt: Any) -> Any:
        count = self._count

        class _Result:
            def scalar(self_inner) -> int:
                return count

        return _Result()


async def test_completeness_pct_5_of_8_rounds_to_63() -> None:
    """5 of 8 core fields populated → 5/8 = 62.5 → rounds to 63."""
    company = _fake_company(
        # Drop 3 of the 8 core fields:
        industry_code=None,
        directors=None,
        website=None,
    )
    session = _StubSession(count=0)
    dq = await svc.compute_data_quality(session, company)  # type: ignore[arg-type]
    assert dq.completeness_pct == 63


async def test_freshness_null_hides_badge_when_no_changes() -> None:
    """Freshness missing AND no CDC rows → recent_changes is None."""
    company = _fake_company(data_freshness_at=None)
    session = _StubSession(count=0)
    dq = await svc.compute_data_quality(session, company)  # type: ignore[arg-type]
    assert dq.freshness_at is None
    assert dq.recent_changes is None


async def test_recent_changes_returns_count() -> None:
    """3 CDC rows in the trailing 30d window → recent_changes == 3."""
    company = _fake_company()
    session = _StubSession(count=3)
    dq = await svc.compute_data_quality(session, company)  # type: ignore[arg-type]
    assert dq.recent_changes == 3


async def test_envelope_round_trips_to_json() -> None:
    """The Pydantic shape matches the redesign-doc spec exactly."""
    company = _fake_company()
    session = _StubSession(count=2)
    dq = await svc.compute_data_quality(session, company)  # type: ignore[arg-type]
    payload = dq.model_dump(mode="json")
    assert set(payload.keys()) == {
        "confidence", "freshness_at", "completeness_pct", "recent_changes",
    }
    assert payload["confidence"] in {"high", "medium", "low"}
    assert isinstance(payload["completeness_pct"], int)


async def test_confidence_defaults_to_medium_when_missing() -> None:
    """confidence_band column should always be set, but envelope handles None."""
    company = _fake_company(confidence_band=None)
    session = _StubSession(count=0)
    dq = await svc.compute_data_quality(session, company)  # type: ignore[arg-type]
    assert dq.confidence == "medium"


def test_core_field_present_address_via_city_only() -> None:
    """A company with city_name but no address_id still counts the 'address' field."""
    company = _fake_company(address_id=None, city_name="Астана")
    assert svc._core_field_present(company, "address") is True  # type: ignore[arg-type]


def test_core_field_present_director_requires_name() -> None:
    """A directors list with empty-name entries does NOT count."""
    company = _fake_company(directors=[{"role": "CEO"}])
    assert svc._core_field_present(company, "director_name") is False  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "populated,expected_pct",
    [
        (("name",), 13),
        (("name", "bin"), 25),
        (("name", "bin", "industry_code", "registration_status",
          "address", "director_name", "phone", "website"), 100),
    ],
)
def test_completeness_table(populated: tuple[str, ...], expected_pct: int) -> None:
    """Spot-check the 1/8, 2/8, 8/8 boundaries."""
    overrides: dict[str, Any] = {
        "name": None, "bin": None, "industry_code": None, "status": None,
        "address_id": None, "city_name": None, "directors": None,
        "phone": None, "website": None,
    }
    mapping = {
        "name": ("name", "ТОО Демо"),
        "bin": ("bin", "123456789012"),
        "industry_code": ("industry_code", "6201"),
        "registration_status": ("status", "active"),
        "address": ("address_id", uuid.uuid4()),
        "director_name": ("directors", [{"name": "X"}]),
        "phone": ("phone", "+7"),
        "website": ("website", "https://x"),
    }
    for key in populated:
        col, val = mapping[key]
        overrides[col] = val
    company = _fake_company(**overrides)
    assert svc._completeness_pct(company) == expected_pct  # type: ignore[arg-type]
