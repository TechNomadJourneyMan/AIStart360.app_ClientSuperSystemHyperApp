"""Widget endpoints (Track G).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.

All endpoints return the standard `{data, meta, errors}` envelope.
The catalog endpoint is unauthenticated so the picker can hydrate before
the user signs in; everything else requires a Supabase JWT.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.core.deps import CurrentUserDep, SessionDep
from app.core.errors import envelope
from app.schemas.envelope import ResponseEnvelope
from app.schemas.widget import (
    AiSuggestRequest,
    AiSuggestResponse,
    WidgetCatalogEntry,
    WidgetCreate,
    WidgetDataResponse,
    WidgetRead,
    WidgetUpdate,
)
from app.services import widgets as widgets_svc
from app.widgets.catalog import get_catalog

router = APIRouter()


# ────────────────────────────────────────────────────────────────────
# Catalog (public)
# ────────────────────────────────────────────────────────────────────


@router.get(
    "/catalog",
    summary="List available widget types",
    response_model=ResponseEnvelope[list[WidgetCatalogEntry]],
)
async def list_catalog() -> dict[str, Any]:
    items = [
        WidgetCatalogEntry(**entry).model_dump(mode="json")
        for entry in get_catalog().values()
    ]
    return envelope(data=items, meta={"count": len(items)})


# ────────────────────────────────────────────────────────────────────
# CRUD (authenticated)
# ────────────────────────────────────────────────────────────────────


@router.get(
    "",
    summary="List current user's widgets",
    response_model=ResponseEnvelope[list[WidgetRead]],
)
async def list_my_widgets(
    session: SessionDep, user: CurrentUserDep
) -> dict[str, Any]:
    rows = await widgets_svc.list_for_user(session, user_id=UUID(user.user_id))
    data = [WidgetRead.model_validate(r).model_dump(mode="json") for r in rows]
    return envelope(data=data, meta={"count": len(data)})


@router.post(
    "",
    summary="Create a widget",
    response_model=ResponseEnvelope[WidgetRead],
    status_code=201,
)
async def create_widget(
    payload: WidgetCreate, session: SessionDep, user: CurrentUserDep
) -> dict[str, Any]:
    row = await widgets_svc.create(
        session, user_id=UUID(user.user_id), payload=payload
    )
    return envelope(data=WidgetRead.model_validate(row).model_dump(mode="json"))


@router.patch(
    "/{widget_id}",
    summary="Update a widget (partial)",
    response_model=ResponseEnvelope[WidgetRead],
)
async def update_widget(
    widget_id: UUID,
    payload: WidgetUpdate,
    session: SessionDep,
    user: CurrentUserDep,
) -> dict[str, Any]:
    row = await widgets_svc.update(
        session,
        widget_id=widget_id,
        user_id=UUID(user.user_id),
        payload=payload,
    )
    return envelope(data=WidgetRead.model_validate(row).model_dump(mode="json"))


@router.delete(
    "/{widget_id}",
    summary="Delete a widget",
    status_code=204,
)
async def delete_widget(
    widget_id: UUID, session: SessionDep, user: CurrentUserDep
) -> None:
    await widgets_svc.delete(
        session, widget_id=widget_id, user_id=UUID(user.user_id)
    )


# ────────────────────────────────────────────────────────────────────
# AI-suggest
# ────────────────────────────────────────────────────────────────────


@router.post(
    "/ai-suggest",
    summary="Convert a NL prompt into a widget config",
    response_model=ResponseEnvelope[AiSuggestResponse],
)
async def ai_suggest(
    payload: AiSuggestRequest, session: SessionDep, user: CurrentUserDep
) -> dict[str, Any]:
    result = await widgets_svc.suggest(
        session,
        user_id=UUID(user.user_id),
        prompt=payload.prompt,
        widget_type=payload.widget_type,
    )
    return envelope(data=result.model_dump(mode="json"))


# ────────────────────────────────────────────────────────────────────
# Server-rendered widget data
# ────────────────────────────────────────────────────────────────────


@router.post(
    "/{widget_id}/data",
    summary="Render widget data on the server",
    response_model=ResponseEnvelope[WidgetDataResponse],
)
async def render_widget_data(
    widget_id: UUID, session: SessionDep, user: CurrentUserDep
) -> dict[str, Any]:
    widget = await widgets_svc.get_for_user(
        session, widget_id=widget_id, user_id=UUID(user.user_id)
    )
    data = await widgets_svc.render_data(session, widget=widget)
    payload = WidgetDataResponse(
        widget_id=widget.id,
        widget_type=widget.widget_type,  # type: ignore[arg-type]
        data=data,
    )
    return envelope(data=payload.model_dump(mode="json"))
