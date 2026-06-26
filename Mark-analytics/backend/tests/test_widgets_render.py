"""`render_data` dispatch tests — one per widget type.

Backing analytics / companies services are mocked so we don't need a DB.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import widgets as widgets_svc
from app.widgets.catalog import WIDGET_CATALOG


def _widget(widget_type: str, params: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        widget_type=widget_type,
        name="test",
        params=params,
        layout=None,
        sort_index=0,
    )


@pytest.fixture
def patch_services(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import analytics as analytics_svc
    from app.services import companies as companies_svc

    async def _overview(_s: Any, *, filters: Any) -> dict[str, Any]:
        return {
            "total_companies": 42,
            "active": 30,
            "liquidated": 12,
            "revenue_total_usd": 1_000_000.0,
            "revenue_avg_usd": 25_000.0,
            "employees_total": 500,
            "new_this_month": 3,
            "mortality_rate_pct": 5.5,
        }

    async def _industry(_s: Any, *, filters: Any, limit: int = 10) -> list[dict[str, Any]]:
        return [{"industry_code": "62", "industry_label": "IT", "companies": 10}]

    async def _region(
        _s: Any, *, filters: Any, country: str = "KZ", metric: str = "count"
    ) -> list[dict[str, Any]]:
        return [{"region_kato": "750000000", "value": 5}]

    async def _size(_s: Any, *, filters: Any) -> list[dict[str, Any]]:
        return [{"bucket": "small", "companies": 4, "revenue_usd": 100.0}]

    async def _growth(_s: Any, *, filters: Any, limit: int = 10) -> list[dict[str, Any]]:
        return [{"id": "x", "name": "ACME", "revenue_usd": 1.0}]

    async def _list_companies(_s: Any, *, filters: Any, q: Any, limit: int, cursor: Any) -> Any:
        row = SimpleNamespace(
            name="ACME TOO",
            industry_label="IT",
            employee_count=50,
            revenue_usd=12345.6,
            updated_at=None,
        )
        return [row], None, 1

    monkeypatch.setattr(analytics_svc, "overview", _overview)
    monkeypatch.setattr(analytics_svc, "industry_distribution", _industry)
    monkeypatch.setattr(analytics_svc, "region_distribution", _region)
    monkeypatch.setattr(analytics_svc, "size_distribution", _size)
    monkeypatch.setattr(analytics_svc, "growth_leaders", _growth)
    monkeypatch.setattr(companies_svc, "list_companies", _list_companies)


@pytest.mark.parametrize("type_id", sorted(WIDGET_CATALOG.keys()))
async def test_render_data_returns_dict_for_each_type(
    type_id: str, patch_services: None
) -> None:
    entry = WIDGET_CATALOG[type_id]
    widget = _widget(type_id, dict(entry["default_params"]))
    result = await widgets_svc.render_data(None, widget=widget)  # type: ignore[arg-type]
    assert isinstance(result, dict)
    assert result  # non-empty


async def test_render_note_returns_markdown(patch_services: None) -> None:
    widget = _widget("note", {"markdown": "# hello"})
    result = await widgets_svc.render_data(None, widget=widget)  # type: ignore[arg-type]
    assert result == {"markdown": "# hello"}


async def test_render_metric_pulls_from_overview(patch_services: None) -> None:
    widget = _widget(
        "metric",
        {"metric_key": "active", "filter_ref": None, "format": "integer"},
    )
    result = await widgets_svc.render_data(None, widget=widget)  # type: ignore[arg-type]
    assert result["metric_key"] == "active"
    assert result["value"] == 30


async def test_render_chart_industry_distribution(patch_services: None) -> None:
    widget = _widget(
        "chart",
        {
            "chart_kind": "bar",
            "data_source": "industry_distribution",
            "top_n": 5,
            "filter_ref": None,
        },
    )
    result = await widgets_svc.render_data(None, widget=widget)  # type: ignore[arg-type]
    assert result["chart_kind"] == "bar"
    assert result["series"][0]["industry_code"] == "62"


async def test_render_list_companies(patch_services: None) -> None:
    widget = _widget(
        "list",
        {
            "data_source": "companies",
            "filter_ref": None,
            "columns": ["name", "industry_label", "revenue_usd"],
            "sort": None,
            "limit": 5,
        },
    )
    result = await widgets_svc.render_data(None, widget=widget)  # type: ignore[arg-type]
    assert result["items"][0]["name"] == "ACME TOO"
    assert result["items"][0]["revenue_usd"] == 12345.6
