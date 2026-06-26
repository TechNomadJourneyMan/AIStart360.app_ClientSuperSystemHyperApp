"""Widget API schemas (Track G).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

WidgetTypeLiteral = Literal["metric", "list", "chart", "map_mini", "news", "note"]


class WidgetCatalogEntry(BaseModel):
    """Catalog entry returned by `GET /widgets/catalog`."""

    id: WidgetTypeLiteral
    name: str
    description: str
    icon: str
    tier: str
    params_schema: dict[str, Any]
    default_params: dict[str, Any]
    data_sources: list[str]


class WidgetLayout(BaseModel):
    """Grid layout box. Extra keys (per-breakpoint overrides) allowed."""

    model_config = ConfigDict(extra="allow")
    x: int = 0
    y: int = 0
    w: int = 4
    h: int = 4


class WidgetCreate(BaseModel):
    widget_type: WidgetTypeLiteral
    name: str = Field(min_length=1, max_length=120)
    params: dict[str, Any]
    layout: WidgetLayout | None = None
    sort_index: int = 0


class WidgetUpdate(BaseModel):
    """All fields optional — partial update."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    params: dict[str, Any] | None = None
    layout: WidgetLayout | None = None
    sort_index: int | None = None


class WidgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    widget_type: WidgetTypeLiteral
    name: str
    params: dict[str, Any]
    layout: dict[str, Any] | None = None
    sort_index: int
    created_at: datetime
    updated_at: datetime


class AiSuggestRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=2000)
    widget_type: WidgetTypeLiteral | None = None


class AiSuggestResponse(BaseModel):
    """Returned by `POST /widgets/ai-suggest`.

    Either `widget_type` + `params` are populated (happy path), or `error` is
    set with a machine-readable reason so the UI can render a "try rephrasing"
    hint. We deliberately do NOT auto-save — the frontend pre-fills the editor.
    """

    widget_type: WidgetTypeLiteral | None = None
    params: dict[str, Any] | None = None
    error: str | None = None
    reason: str | None = None
    raw: str | None = None


class WidgetDataResponse(BaseModel):
    """Server-rendered data payload for one widget.

    Shape varies by widget type — captured in the `kind` discriminator on the
    `data` envelope. We keep it loose (Any) on the wire so each renderer is
    free to evolve its own internal shape.
    """

    widget_id: UUID
    widget_type: WidgetTypeLiteral
    data: dict[str, Any]
