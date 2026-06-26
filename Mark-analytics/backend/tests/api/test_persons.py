"""Tests for the Sprint 4.2 persons API.

Pure unit-style: we override `app.core.deps.get_session` so the routers can be
mounted without a real Postgres, and we monkeypatch the service layer to return
canned rows. The pure helpers (`normalize_role_history`, `compute_data_quality`,
`current_roles`) are exercised directly without monkeypatching.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import persons as persons_module
from app.core.deps import get_session
from app.core.errors import (
    AppError,
    app_error_handler,
    http_handler,
    validation_handler,
)
from app.schemas.person import RoleHistoryEntry
from app.services.persons import (
    compute_data_quality,
    current_roles,
    normalize_role_history,
)

# ────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────


_COMPANY_A = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
_COMPANY_B = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")


def _fake_person(**overrides: Any) -> SimpleNamespace:
    base = dict(
        id=uuid.uuid4(),
        iin=None,
        full_name="Айбек Серикулы",
        name_normalized="айбек серикулы",
        country="KZ",
        sanctions=False,
        contacts=None,
        raw=None,
        role_history=[
            {
                "company_id": str(_COMPANY_A),
                "company_name": "Demo TOO",
                "role": "director",
                "started_at": "2020-01-01",
                "ended_at": None,
                "source": "stat.gov.kz",
            },
            {
                "company_id": str(_COMPANY_B),
                "company_name": "Old AO",
                "role": "founder",
                "started_at": "2015-05-15",
                "ended_at": "2019-06-30",
                "source": "kgd.gov.kz",
            },
            {
                "company_id": str(_COMPANY_A),
                "company_name": "Demo TOO",
                "role": "board_member",
                "started_at": "2017-04-01",
                "ended_at": "2019-12-31",
                "source": "seed",
            },
        ],
        updated_at=datetime(2026, 5, 20, 12, 0, tzinfo=UTC),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


async def _empty_session() -> AsyncIterator[None]:
    yield None


def _build_app() -> FastAPI:
    test_app = FastAPI()
    test_app.include_router(persons_module.router, prefix="/api/v1/persons", tags=["persons"])
    test_app.include_router(
        persons_module.companies_people_router,
        prefix="/api/v1/companies",
        tags=["persons"],
    )
    test_app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(
        RequestValidationError, validation_handler  # type: ignore[arg-type]
    )
    test_app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    test_app.dependency_overrides[get_session] = _empty_session
    return test_app


async def _get(test_app: FastAPI, path: str) -> tuple[int, dict[str, Any]]:
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(path)
    return resp.status_code, resp.json()


# ────────────────────────────────────────────────────────────────────
# Pure helpers
# ────────────────────────────────────────────────────────────────────


def test_normalize_role_history_sorts_started_at_desc_nulls_last() -> None:
    raw = [
        {"company_id": str(_COMPANY_A), "role": "x", "started_at": None},
        {"company_id": str(_COMPANY_B), "role": "y", "started_at": "2020-01-01"},
        {"company_id": str(_COMPANY_A), "role": "z", "started_at": "2022-06-01"},
        "garbage row, should be skipped",
    ]
    entries = normalize_role_history(raw)
    assert len(entries) == 3
    assert entries[0].started_at == date(2022, 6, 1)
    assert entries[1].started_at == date(2020, 1, 1)
    assert entries[2].started_at is None


def test_current_roles_filters_out_ended() -> None:
    entries = normalize_role_history(_fake_person().role_history)
    current = current_roles(entries)
    assert len(current) == 1
    assert current[0].role == "director"
    assert current[0].ended_at is None


def test_compute_data_quality_with_missing_fields() -> None:
    # Default fake person has iin=None and contacts=None; we additionally null
    # out country here to land on a clean 1/4 = 0.25 completeness.
    person = _fake_person(country=None, iin=None, contacts=None)
    dq = compute_data_quality(person)
    assert dq.completeness == 0.25  # 1/4 fields present (full_name only)
    assert "country" in dq.missing_fields
    assert "iin" in dq.missing_fields
    assert "contacts" in dq.missing_fields
    assert "full_name" not in dq.missing_fields

    # Now fill them in and the score should jump to 1.0.
    full = _fake_person(iin="900101300100", contacts={"phone": "+7"})
    dq_full = compute_data_quality(full)
    assert dq_full.completeness == 1.0
    assert dq_full.missing_fields == []


# ────────────────────────────────────────────────────────────────────
# API — list with filters
# ────────────────────────────────────────────────────────────────────


async def test_list_persons_with_filters_returns_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [_fake_person(full_name="Aiken One"), _fake_person(full_name="Aiken Two")]
    captured: dict[str, Any] = {}

    async def _fake_list(_session: Any, **kwargs: Any) -> tuple[list[Any], int]:
        captured.update(kwargs)
        return rows, len(rows)

    monkeypatch.setattr(persons_module, "list_persons", _fake_list)

    test_app = _build_app()
    status, body = await _get(
        test_app,
        f"/api/v1/persons?q=aiken&company_id={_COMPANY_A}&role=director&limit=10&offset=0",
    )
    assert status == 200
    assert len(body["data"]) == 2
    assert body["meta"]["total"] == 2
    assert body["meta"]["filters_received"]["q"] == "aiken"
    assert body["meta"]["filters_received"]["role"] == "director"
    assert body["meta"]["filters_received"]["company_id"] == str(_COMPANY_A)

    # The router forwarded the right kwargs to the service layer.
    assert captured["q"] == "aiken"
    assert captured["company_id"] == _COMPANY_A
    assert captured["role"] == "director"
    assert captured["limit"] == 10
    assert captured["offset"] == 0


# ────────────────────────────────────────────────────────────────────
# API — detail
# ────────────────────────────────────────────────────────────────────


async def test_person_detail_aggregates_role_history_ordered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    person = _fake_person()

    async def _fake_get(_session: Any, _person_id: uuid.UUID) -> Any:
        return person

    monkeypatch.setattr(persons_module, "get_person", _fake_get)

    test_app = _build_app()
    status, body = await _get(test_app, f"/api/v1/persons/{person.id}")
    assert status == 200
    data = body["data"]
    assert data["full_name"] == "Айбек Серикулы"
    assert data["country"] == "KZ"

    # role_history sorted started_at desc — first should be the 2020 director role.
    history = data["role_history"]
    assert len(history) == 3
    assert history[0]["role"] == "director"
    assert history[0]["started_at"] == "2020-01-01"
    assert history[1]["started_at"] == "2017-04-01"
    assert history[2]["started_at"] == "2015-05-15"

    # current_roles: only the open-ended one.
    current = data["current_roles"]
    assert len(current) == 1
    assert current[0]["ended_at"] is None
    assert current[0]["company_id"] == str(_COMPANY_A)

    # data_quality envelope present with shape.
    dq = data["data_quality"]
    assert 0.0 <= dq["completeness"] <= 1.0
    assert isinstance(dq["missing_fields"], list)


async def test_person_detail_404(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_get(_session: Any, _person_id: uuid.UUID) -> Any:
        return None

    monkeypatch.setattr(persons_module, "get_person", _fake_get)

    test_app = _build_app()
    status, body = await _get(test_app, f"/api/v1/persons/{uuid.uuid4()}")
    assert status == 404
    assert body["errors"][0]["code"] == "PERSON_NOT_FOUND"


# ────────────────────────────────────────────────────────────────────
# API — /companies/{id}/people
# ────────────────────────────────────────────────────────────────────


async def test_company_people_returns_only_current_roles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    person = _fake_person()
    expected_entry = RoleHistoryEntry(
        company_id=_COMPANY_A,
        company_name="Demo TOO",
        role="director",
        started_at=date(2020, 1, 1),
        ended_at=None,
        source="stat.gov.kz",
    )

    async def _fake_pairs(
        _session: Any, _company_id: uuid.UUID, **kwargs: Any
    ) -> list[tuple[Any, RoleHistoryEntry]]:
        # Service contract: only current roles are returned when current_only=True.
        assert kwargs["current_only"] is True
        return [(person, expected_entry)]

    monkeypatch.setattr(persons_module, "get_company_people", _fake_pairs)

    test_app = _build_app()
    status, body = await _get(test_app, f"/api/v1/companies/{_COMPANY_A}/people")
    assert status == 200
    data = body["data"]
    assert len(data) == 1
    row = data[0]
    assert row["person_id"] == str(person.id)
    assert row["role"] == "director"
    assert row["ended_at"] is None
    assert row["company_id"] == str(_COMPANY_A)
    assert row["source"] == "stat.gov.kz"
    assert body["meta"]["current_only"] is True
    assert body["meta"]["count"] == 1
