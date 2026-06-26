"""Tests for the enriched company detail + sub-resources.

The DB-touching tests are marked `integration` and skipped if Postgres isn't
reachable (pgvector + asyncpg make an in-memory swap impractical). The first
test covers the Pydantic shape and the pure-Python scoring/insight functions —
no DB required.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas.company import (
    CompanyDetail,
    CompanyInsight,
    CompanyScores,
    TimelineEvent,
)
from app.services.companies import (
    compute_company_insights,
    compute_scores,
)


def _fake_company(**overrides: Any) -> SimpleNamespace:
    """Duck-type a Company without touching SQLAlchemy."""
    base = dict(
        id=uuid.uuid4(),
        bin="123456789012",
        inn=None,
        ogrn=None,
        name="Demo TOO",
        name_normalized="demo too",
        country="KZ",
        legal_form="TOO",
        status="active",
        registered_at=(datetime.now(timezone.utc) - timedelta(days=365 * 12)).date(),
        industry_code="6201",
        industry_label="Computer programming",
        employee_count=120,
        revenue_usd=Decimal("5000000.00"),
        capitalization_usd=None,
        website="https://demo.kz",
        email="hi@demo.kz",
        phone="+7-700-000-0000",
        address_id=uuid.uuid4(),
        description="A demo company.",
        tags=["b2b", "saas", "linkedin"],
        confidence=Decimal("0.85"),
        risk_score=None,
        source_ids=None,
        raw=None,
        last_seen_at=None,
        merged_into_id=None,
        embedding=None,
        updated_at=datetime.now(timezone.utc) - timedelta(days=10),
        address=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_company_detail_schema_shape() -> None:
    """CompanyDetail accepts the enriched payload and round-trips JSON."""
    company = _fake_company()
    peer = {
        "peer_count": 30, "emp_median": 25.0, "rev_median": 1_000_000.0,
        "mortality_pct": 5.0, "revenue_rank": 2,
        "emp_percentile": 88.0, "rev_percentile": 92.0,
    }
    scores = compute_scores(company, peer)
    related: list[dict[str, Any]] = []
    insights = compute_company_insights(company, peer, scores, related)

    assert isinstance(scores, CompanyScores)
    assert 0 <= scores.digital_maturity <= 5
    assert 0 <= scores.data_completeness_pct <= 100
    assert scores.risk_level in {"low", "medium", "high"}

    # Insights should include "Лидер в нише" (rank=2, peer_count=30)
    titles = [i.title for i in insights]
    assert any("Лидер" in t for t in titles)
    assert all(isinstance(i, CompanyInsight) for i in insights)
    assert len(insights) <= 6

    detail = CompanyDetail(
        id=company.id, name=company.name, country=company.country,
        updated_at=company.updated_at,
        scores=scores, insights=insights, similar=[], timeline_events=[],
        related_tenders=[],
    )
    payload = detail.model_dump(mode="json")
    expected_keys = {
        "id", "name", "country", "updated_at", "scores", "insights",
        "similar", "timeline_events", "related_tenders", "description",
        "field_provenance",
    }
    assert expected_keys.issubset(payload.keys())
    assert payload["scores"]["risk_level"] in {"low", "medium", "high"}


def test_risk_level_high_when_liquidated() -> None:
    company = _fake_company(status="liquidated")
    peer = {
        "peer_count": 10, "emp_median": 0, "rev_median": 0,
        "mortality_pct": 0.0, "revenue_rank": None,
        "emp_percentile": 0, "rev_percentile": 0,
    }
    scores = compute_scores(company, peer)
    assert scores.risk_level == "high"


def test_low_digital_maturity_triggers_insight() -> None:
    company = _fake_company(website=None, email=None, phone=None, tags=None,
                            industry_code="4711")
    peer = {
        "peer_count": 10, "emp_median": 200, "rev_median": 0,
        "mortality_pct": 0.0, "revenue_rank": None,
        "emp_percentile": 10, "rev_percentile": 10,
    }
    scores = compute_scores(company, peer)
    insights = compute_company_insights(company, peer, scores, [])
    titles = [i.title for i in insights]
    assert "Низкая цифровая представленность" in titles


def test_timeline_event_shape() -> None:
    ev = TimelineEvent(
        at=datetime.now(timezone.utc), kind="registered", label="Зарегистрирована",
        payload={"date": "2010-01-01"},
    )
    out = ev.model_dump(mode="json")
    assert set(out.keys()) == {"at", "kind", "label", "payload"}


@pytest.mark.integration
async def test_company_detail_endpoint_404() -> None:
    """404 path uses no DB rows but still hits a DB session — integration only."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/companies/{uuid.uuid4()}")
    assert resp.status_code == 404
    body = resp.json()
    assert body["errors"][0]["code"] == "COMPANY_NOT_FOUND"


@pytest.mark.integration
async def test_company_routes_registered() -> None:
    """The 3 new sub-resources must be wired into the FastAPI app."""
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/api/v1/companies/{company_id}/similar" in paths
    assert "/api/v1/companies/{company_id}/timeline" in paths
    assert "/api/v1/companies/{company_id}/insights" in paths
