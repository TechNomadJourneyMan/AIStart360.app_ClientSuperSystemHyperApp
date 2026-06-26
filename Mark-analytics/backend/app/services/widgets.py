"""Widget service (Track G).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.

Single async module exposing:
  - CRUD (`list_for_user`, `create`, `update`, `delete`)
  - `seed_defaults`        — idempotent first-login fixture
  - `render_data`           — dispatcher that calls the right backend
                              service for a widget's `widget_type`
  - `suggest`               — AI-assisted NL → widget config (Gemini Flash
                              via the existing AI Gateway)

The service is the *only* place that talks to `app.widgets.catalog.validate_params`
on write, and the *only* place that talks to the AI Gateway for widget suggest.
Routers stay thin (marshal → service → envelope).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import ChatMessage, GenerateRequest, Task, gateway
from app.core.errors import (
    AIGatewayUnavailable,
    NotFoundError,
    ValidationError,
)
from app.core.logging import get_logger
from app.models.user_widget import UserWidget
from app.schemas.widget import (
    AiSuggestResponse,
    WidgetCreate,
    WidgetUpdate,
)
from app.widgets.catalog import (
    WIDGET_CATALOG,
    get_type,
    list_type_ids,
    validate_params,
)

logger = get_logger(__name__)

_PROMPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "ai"
    / "prompts"
    / "widget_suggest_v1.txt"
)


# ────────────────────────────────────────────────────────────────────
# CRUD
# ────────────────────────────────────────────────────────────────────


async def list_for_user(
    session: AsyncSession, *, user_id: UUID
) -> list[UserWidget]:
    stmt = (
        select(UserWidget)
        .where(UserWidget.user_id == user_id)
        .order_by(UserWidget.sort_index, UserWidget.created_at)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_for_user(
    session: AsyncSession, *, widget_id: UUID, user_id: UUID
) -> UserWidget:
    """Fetch a widget, raising 404 if not owned by `user_id`.

    Using NotFound (not Forbidden) for cross-user lookups avoids leaking
    widget-id existence to other users.
    """
    stmt = select(UserWidget).where(UserWidget.id == widget_id)
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        raise NotFoundError(
            f"Widget {widget_id} not found", code="WIDGET_NOT_FOUND"
        )
    return row


async def create(
    session: AsyncSession, *, user_id: UUID, payload: WidgetCreate
) -> UserWidget:
    validate_params(payload.widget_type, payload.params)
    layout = payload.layout.model_dump() if payload.layout else None
    widget = UserWidget(
        user_id=user_id,
        widget_type=payload.widget_type,
        name=payload.name,
        params=payload.params,
        layout=layout,
        sort_index=payload.sort_index,
    )
    session.add(widget)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise ValidationError(
            "Widget violates DB constraint",
            code="WIDGET_DB_INVALID",
            details={"db_error": str(e.orig)},
        ) from e
    await session.refresh(widget)
    return widget


async def update(
    session: AsyncSession,
    *,
    widget_id: UUID,
    user_id: UUID,
    payload: WidgetUpdate,
) -> UserWidget:
    widget = await get_for_user(session, widget_id=widget_id, user_id=user_id)
    if payload.params is not None:
        validate_params(widget.widget_type, payload.params)
        widget.params = payload.params
    if payload.name is not None:
        widget.name = payload.name
    if payload.layout is not None:
        widget.layout = payload.layout.model_dump()
    if payload.sort_index is not None:
        widget.sort_index = payload.sort_index
    await session.commit()
    await session.refresh(widget)
    return widget


async def delete(
    session: AsyncSession, *, widget_id: UUID, user_id: UUID
) -> None:
    widget = await get_for_user(session, widget_id=widget_id, user_id=user_id)
    await session.execute(sa_delete(UserWidget).where(UserWidget.id == widget.id))
    await session.commit()


# ────────────────────────────────────────────────────────────────────
# Seed defaults
# ────────────────────────────────────────────────────────────────────

# Default mapping — mirrors today's hardcoded 7 widgets at
# `frontend/src/app/routes/index.tsx`:
#   MacroDashboard       → metric (total_companies)
#   MarketTicker         → list   (companies, sorted by revenue)
#   IndustryHeatmap      → chart  (bar, industry_distribution)
#   TopCompanies         → list   (companies, sorted by revenue desc)
#   SizeDistribution     → chart  (bar, size_distribution)
#   RecentTenders        → list   (tenders, recent)
#   NewsFeed             → news   (empty filter — all sources)
#
# Each entry is rendered as a `WidgetCreate`-compatible dict so callers can
# round-trip through `create()` and get the same DB shape used in production.

DEFAULT_WIDGETS: list[dict[str, Any]] = [
    {
        "widget_type": "metric",
        "name": "Macro Dashboard",
        "params": {
            "metric_key": "total_companies",
            "filter_ref": None,
            "format": "integer",
        },
        "sort_index": 0,
    },
    {
        "widget_type": "list",
        "name": "Market Ticker",
        "params": {
            "data_source": "companies",
            "filter_ref": None,
            "columns": ["name", "industry_label", "revenue_usd"],
            "sort": "-updated_at",
            "limit": 10,
        },
        "sort_index": 1,
    },
    {
        "widget_type": "chart",
        "name": "Industry Heatmap",
        "params": {
            "chart_kind": "bar",
            "data_source": "industry_distribution",
            "top_n": 10,
            "filter_ref": None,
        },
        "sort_index": 2,
    },
    {
        "widget_type": "list",
        "name": "Top Companies",
        "params": {
            "data_source": "companies",
            "filter_ref": None,
            "columns": ["name", "industry_label", "employee_count", "revenue_usd"],
            "sort": "-revenue_usd",
            "limit": 10,
        },
        "sort_index": 3,
    },
    {
        "widget_type": "chart",
        "name": "Size Distribution",
        "params": {
            "chart_kind": "bar",
            "data_source": "size_distribution",
            "top_n": 10,
            "filter_ref": None,
        },
        "sort_index": 4,
    },
    {
        "widget_type": "list",
        "name": "Recent Tenders",
        "params": {
            "data_source": "tenders",
            "filter_ref": None,
            "columns": ["title", "published_at", "amount_usd"],
            "sort": "-published_at",
            "limit": 10,
        },
        "sort_index": 5,
    },
    {
        "widget_type": "news",
        "name": "News Feed",
        "params": {"sources": [], "keywords": [], "limit": 10},
        "sort_index": 6,
    },
]


async def seed_defaults(session: AsyncSession, *, user_id: UUID) -> list[UserWidget]:
    """Create the 7 default widgets for `user_id` if they have none.

    Idempotent: if any widget already exists for the user, returns the current
    set without inserting. Safe to call on every login.
    """
    existing_stmt = select(UserWidget).where(UserWidget.user_id == user_id).limit(1)
    if (await session.execute(existing_stmt)).scalar_one_or_none() is not None:
        return await list_for_user(session, user_id=user_id)

    for spec in DEFAULT_WIDGETS:
        validate_params(spec["widget_type"], spec["params"])
        session.add(
            UserWidget(
                user_id=user_id,
                widget_type=spec["widget_type"],
                name=spec["name"],
                params=spec["params"],
                layout=None,
                sort_index=spec["sort_index"],
            )
        )
    await session.commit()
    return await list_for_user(session, user_id=user_id)


# ────────────────────────────────────────────────────────────────────
# render_data — dispatcher
# ────────────────────────────────────────────────────────────────────


async def render_data(
    session: AsyncSession, *, widget: UserWidget
) -> dict[str, Any]:
    """Return the data payload for `widget` ready for the frontend.

    Each branch calls the existing analytics / companies / tenders / news
    service. We deliberately keep these wrappers thin so they can be mocked
    individually in tests.
    """
    if widget.widget_type == "note":
        return _render_note(widget.params)
    if widget.widget_type == "metric":
        return await _render_metric(session, widget.params)
    if widget.widget_type == "list":
        return await _render_list(session, widget.params)
    if widget.widget_type == "chart":
        return await _render_chart(session, widget.params)
    if widget.widget_type == "map_mini":
        return await _render_map_mini(session, widget.params)
    if widget.widget_type == "news":
        return await _render_news(session, widget.params)
    raise ValidationError(
        f"No renderer for widget_type={widget.widget_type}",
        code="WIDGET_NO_RENDERER",
    )


def _render_note(params: dict[str, Any]) -> dict[str, Any]:
    return {"markdown": params.get("markdown", "")}


async def _render_metric(
    session: AsyncSession, params: dict[str, Any]
) -> dict[str, Any]:
    from app.services import analytics as analytics_svc

    overview = await analytics_svc.overview(session, filters={})
    key = params["metric_key"]
    value = overview.get(key)
    return {
        "metric_key": key,
        "value": value,
        "format": params.get("format", "integer"),
    }


async def _render_list(
    session: AsyncSession, params: dict[str, Any]
) -> dict[str, Any]:
    from app.services import companies as companies_svc

    source = params["data_source"]
    columns = params["columns"]
    limit = params["limit"]

    if source == "companies":
        rows, _next_cursor, total = await companies_svc.list_companies(
            session, filters={}, q=None, limit=limit, cursor=None
        )
        items = [_pluck(r, columns) for r in rows]
        return {
            "data_source": source,
            "columns": columns,
            "items": items,
            "total": total,
        }

    if source == "tenders":
        # Tenders endpoint is a Phase 0 stub — return an empty list with the
        # right shape so the renderer never crashes.
        return {
            "data_source": source,
            "columns": columns,
            "items": [],
            "total": 0,
        }

    if source == "saved_list":
        return {
            "data_source": source,
            "columns": columns,
            "items": [],
            "total": 0,
        }

    raise ValidationError(
        f"Unknown list data_source: {source}",
        code="WIDGET_DATA_SOURCE_UNKNOWN",
    )


async def _render_chart(
    session: AsyncSession, params: dict[str, Any]
) -> dict[str, Any]:
    from app.services import analytics as analytics_svc

    source = params["data_source"]
    top_n = params["top_n"]
    kind = params["chart_kind"]

    if source == "industry_distribution":
        series = await analytics_svc.industry_distribution(
            session, filters={}, limit=top_n
        )
    elif source == "region_distribution":
        full = await analytics_svc.region_distribution(
            session, filters={}, metric="count"
        )
        series = full[:top_n]
    elif source == "size_distribution":
        series = await analytics_svc.size_distribution(session, filters={})
    elif source == "growth_leaders":
        series = await analytics_svc.growth_leaders(
            session, filters={}, limit=top_n
        )
    else:
        raise ValidationError(
            f"Unknown chart data_source: {source}",
            code="WIDGET_DATA_SOURCE_UNKNOWN",
        )

    return {"chart_kind": kind, "data_source": source, "series": series}


async def _render_map_mini(
    session: AsyncSession, params: dict[str, Any]
) -> dict[str, Any]:
    # geo.companies_feature_collection requires a full bbox + many args. For a
    # mini widget we surface the resolved bbox + filter_ref and let the
    # frontend hit the existing /geo endpoint with the right params; the
    # widget data response just carries config + a count hint.
    from app.services import companies as companies_svc

    _rows, _next_cursor, total = await companies_svc.list_companies(
        session, filters={}, q=None, limit=1, cursor=None
    )
    return {
        "filter_ref": params["filter_ref"],
        "bbox": params.get("bbox"),
        "company_count": total,
    }


async def _render_news(
    _session: AsyncSession, params: dict[str, Any]
) -> dict[str, Any]:
    # News spider is Phase-2 (see 07-product-redesign.md §7). Until it lands,
    # return an empty-but-shaped payload so the frontend renderer has stable
    # contract.
    return {
        "sources": params.get("sources", []),
        "keywords": params.get("keywords", []),
        "items": [],
    }


def _pluck(row: Any, columns: list[str]) -> dict[str, Any]:
    """Return a flat dict with just `columns` pulled from `row`."""
    from decimal import Decimal

    out: dict[str, Any] = {}
    for col in columns:
        value = getattr(row, col, None)
        # Coerce Decimal early so the wire shape is float-ish; other JSON-ugly
        # types (UUID, datetime) are handled by the envelope serialiser.
        if isinstance(value, Decimal):
            value = float(value)
        out[col] = value
    return out


# ────────────────────────────────────────────────────────────────────
# AI-assisted suggest
# ────────────────────────────────────────────────────────────────────


def _load_prompt_template() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8").strip()


def _build_prompt(
    *, widget_type: str, prompt: str, schema: dict[str, Any], data_sources: list[str]
) -> str:
    template = _load_prompt_template()
    return template.format(
        widget_type=widget_type,
        schema=json.dumps(schema, ensure_ascii=False),
        data_sources=", ".join(data_sources) if data_sources else "(none)",
        prompt=prompt,
    )


async def suggest(
    session: AsyncSession,
    *,
    user_id: UUID,
    prompt: str,
    widget_type: str | None = None,
) -> AiSuggestResponse:
    """Convert a free-form prompt into a widget config via the AI Gateway.

    Returns `AiSuggestResponse` with either `widget_type + params` filled
    (happy path) or `error + reason` set (schema/LLM failure).
    """
    target_type = widget_type or _pick_type_from_prompt(prompt)
    entry = get_type(target_type)
    if entry is None:
        return AiSuggestResponse(
            error="unknown_widget_type",
            reason=f"Widget type {target_type!r} is not in the catalog.",
        )

    system_prompt = _build_prompt(
        widget_type=target_type,
        prompt=prompt,
        schema=entry["params_schema"],
        data_sources=entry["data_sources"],
    )

    # Quota: count this AI call against the user's monthly envelope. We do it
    # via the existing users.requests_used column so it's visible on /me/usage.
    await _bump_ai_quota(session, user_id=user_id)

    try:
        resp = await gateway.generate(
            GenerateRequest(
                task=Task.EXTRACT_QUERY_FILTERS,
                messages=[
                    ChatMessage(role="system", content=system_prompt),
                    ChatMessage(role="user", content=prompt),
                ],
                temperature=0.0,
                max_tokens=512,
                json_schema=entry["params_schema"],
                agent="widget_suggest_v1",
                metadata={"widget_type": target_type, "user_id": str(user_id)},
            )
        )
    except AIGatewayUnavailable as exc:
        logger.warning("widget_suggest_ai_unavailable", error=str(exc))
        return AiSuggestResponse(
            error="ai_unavailable",
            reason=str(exc),
        )

    raw = (resp.text or "").strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return AiSuggestResponse(
            error="schema_validation",
            reason=f"LLM returned non-JSON: {exc.msg}",
            raw=raw,
        )

    try:
        validate_params(target_type, parsed)
    except ValidationError as exc:
        return AiSuggestResponse(
            error="schema_validation",
            reason=exc.message,
            raw=raw,
        )

    # `target_type` is narrowed to a catalog key here (we checked above).
    return AiSuggestResponse.model_validate(
        {"widget_type": target_type, "params": parsed}
    )


def _pick_type_from_prompt(prompt: str) -> str:
    """Tiny heuristic when the caller didn't pin a widget_type.

    Keeps the AI call cost down for the common case ("show me X" → list /
    chart). The LLM is still asked to fill the params; we just decide which
    schema constrains the output.
    """
    lower = prompt.lower()
    if any(w in lower for w in ("chart", "diagram", "bar", "pie", "line", "график", "диаграмм")):
        return "chart"
    if any(w in lower for w in ("map", "карта", "geo")):
        return "map_mini"
    if any(w in lower for w in ("news", "новости", "rss")):
        return "news"
    if any(w in lower for w in ("note", "memo", "заметка")):
        return "note"
    if any(w in lower for w in ("metric", "число", "kpi", "count")):
        return "metric"
    return "list"


async def _bump_ai_quota(session: AsyncSession, *, user_id: UUID) -> None:
    """Increment `users.requests_used` by 1.

    Falls back to no-op if the row does not exist (test fixtures with a fake
    session can bypass this — we don't want to crash the suggest call in that
    case).
    """
    from app.models.user import User

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        return
    user.requests_used = (user.requests_used or 0) + 1
    await session.commit()


# Re-export for callers who want to introspect the type list (e.g. tests).
__all__ = [
    "DEFAULT_WIDGETS",
    "WIDGET_CATALOG",
    "create",
    "delete",
    "get_for_user",
    "list_for_user",
    "list_type_ids",
    "render_data",
    "seed_defaults",
    "suggest",
    "update",
]
