"""Canonical widget catalog.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G —
"Six built-in widget types (v1)".

Each entry exposes:
  - `id`        — type key referenced by `user_widgets.widget_type`
  - `name`      — UI label
  - `description`
  - `icon`      — lucide icon name
  - `tier`      — minimum subscription tier required to *create* one
  - `params_schema`   — JSON Schema (draft-07) validated server-side on every
                        write. Frontend uses the same schema to auto-render the
                        editor form.
  - `default_params`  — used by the picker as the starting point and asserted
                        valid in tests so we never ship a self-inconsistent
                        catalog entry.
  - `data_sources`    — list of internal source ids that the widget renderer
                        may dispatch to. Empty list means "no backing data"
                        (i.e. `note`).

The dict is intentionally module-level + immutable in spirit. Adding a new
widget type is a backend-only change: a new entry here + a new renderer in
`app.services.widgets.render_data`.
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from jsonschema import Draft7Validator  # type: ignore[import-untyped]
from jsonschema.exceptions import (  # type: ignore[import-untyped]
    ValidationError as JSONSchemaValidationError,
)

from app.core.errors import ValidationError


class WidgetType(TypedDict):
    id: str
    name: str
    description: str
    icon: str
    tier: str
    params_schema: dict[str, Any]
    default_params: dict[str, Any]
    data_sources: list[str]


# ────────────────────────────────────────────────────────────────────
# Schemas
# ────────────────────────────────────────────────────────────────────

_METRIC_SCHEMA: Final[dict[str, Any]] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "MetricWidgetParams",
    "type": "object",
    "additionalProperties": False,
    "required": ["metric_key", "format"],
    "properties": {
        "metric_key": {
            "type": "string",
            "enum": [
                "total_companies",
                "active",
                "liquidated",
                "revenue_total_usd",
                "revenue_avg_usd",
                "employees_total",
                "new_this_month",
                "mortality_rate_pct",
            ],
        },
        "filter_ref": {"type": ["string", "null"]},
        "format": {"type": "string", "enum": ["integer", "currency", "percent"]},
    },
}

_LIST_SCHEMA: Final[dict[str, Any]] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "ListWidgetParams",
    "type": "object",
    "additionalProperties": False,
    "required": ["data_source", "columns", "limit"],
    "properties": {
        "data_source": {
            "type": "string",
            "enum": ["companies", "tenders", "saved_list"],
        },
        "filter_ref": {"type": ["string", "null"]},
        "columns": {
            "type": "array",
            "minItems": 1,
            "maxItems": 10,
            "items": {"type": "string"},
        },
        "sort": {"type": ["string", "null"]},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
    },
}

_CHART_SCHEMA: Final[dict[str, Any]] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "ChartWidgetParams",
    "type": "object",
    "additionalProperties": False,
    "required": ["chart_kind", "data_source", "top_n"],
    "properties": {
        "chart_kind": {"type": "string", "enum": ["bar", "pie", "line"]},
        "data_source": {
            "type": "string",
            "enum": [
                "industry_distribution",
                "region_distribution",
                "size_distribution",
                "growth_leaders",
            ],
        },
        "top_n": {"type": "integer", "minimum": 1, "maximum": 50},
        "filter_ref": {"type": ["string", "null"]},
    },
}

_MAP_MINI_SCHEMA: Final[dict[str, Any]] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "MapMiniWidgetParams",
    "type": "object",
    "additionalProperties": False,
    "required": ["filter_ref"],
    "properties": {
        "filter_ref": {"type": "string"},
        "bbox": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "required": ["west", "south", "east", "north"],
            "properties": {
                "west": {"type": "number"},
                "south": {"type": "number"},
                "east": {"type": "number"},
                "north": {"type": "number"},
            },
        },
    },
}

_NEWS_SCHEMA: Final[dict[str, Any]] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "NewsWidgetParams",
    "type": "object",
    "additionalProperties": False,
    "required": ["sources", "keywords", "limit"],
    "properties": {
        "sources": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 20,
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 20,
        },
        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
    },
}

_NOTE_SCHEMA: Final[dict[str, Any]] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "NoteWidgetParams",
    "type": "object",
    "additionalProperties": False,
    "required": ["markdown"],
    "properties": {
        "markdown": {"type": "string", "maxLength": 8000},
    },
}


# ────────────────────────────────────────────────────────────────────
# Catalog
# ────────────────────────────────────────────────────────────────────

WIDGET_CATALOG: Final[dict[str, WidgetType]] = {
    "metric": {
        "id": "metric",
        "name": "Metric",
        "description": "A single big number rendered from one analytics metric.",
        "icon": "Gauge",
        "tier": "free",
        "params_schema": _METRIC_SCHEMA,
        "default_params": {
            "metric_key": "total_companies",
            "filter_ref": None,
            "format": "integer",
        },
        "data_sources": ["analytics.overview"],
    },
    "list": {
        "id": "list",
        "name": "List",
        "description": "A compact table of entities (companies, tenders, saved list).",
        "icon": "List",
        "tier": "free",
        "params_schema": _LIST_SCHEMA,
        "default_params": {
            "data_source": "companies",
            "filter_ref": None,
            "columns": ["name", "industry_label", "employee_count", "revenue_usd"],
            "sort": "-revenue_usd",
            "limit": 10,
        },
        "data_sources": ["companies", "tenders", "saved_list"],
    },
    "chart": {
        "id": "chart",
        "name": "Chart",
        "description": "Bar / pie / line chart over a distribution metric.",
        "icon": "BarChart3",
        "tier": "free",
        "params_schema": _CHART_SCHEMA,
        "default_params": {
            "chart_kind": "bar",
            "data_source": "industry_distribution",
            "top_n": 10,
            "filter_ref": None,
        },
        "data_sources": [
            "industry_distribution",
            "region_distribution",
            "size_distribution",
            "growth_leaders",
        ],
    },
    "map_mini": {
        "id": "map_mini",
        "name": "Mini map",
        "description": "Compact map showing companies matching a saved filter.",
        "icon": "Map",
        "tier": "starter",
        "params_schema": _MAP_MINI_SCHEMA,
        "default_params": {
            "filter_ref": "default",
            "bbox": None,
        },
        "data_sources": ["geo.companies"],
    },
    "news": {
        "id": "news",
        "name": "News",
        "description": "RSS / news slice filtered by sources and keywords.",
        "icon": "Newspaper",
        "tier": "free",
        "params_schema": _NEWS_SCHEMA,
        "default_params": {
            "sources": [],
            "keywords": [],
            "limit": 10,
        },
        "data_sources": ["news"],
    },
    "note": {
        "id": "note",
        "name": "Note",
        "description": "Free-form markdown note. No backing data.",
        "icon": "StickyNote",
        "tier": "free",
        "params_schema": _NOTE_SCHEMA,
        "default_params": {"markdown": ""},
        "data_sources": [],
    },
}


# ────────────────────────────────────────────────────────────────────
# Public accessors
# ────────────────────────────────────────────────────────────────────


def get_catalog() -> dict[str, WidgetType]:
    """Return the full catalog. Caller must not mutate."""
    return WIDGET_CATALOG


def get_type(type_id: str) -> WidgetType | None:
    return WIDGET_CATALOG.get(type_id)


def list_type_ids() -> list[str]:
    return list(WIDGET_CATALOG.keys())


def validate_params(type_id: str, params: dict[str, Any]) -> None:
    """Raise `ValidationError` if `params` do not match the catalog schema.

    Used by the service layer on every create/update.
    """
    entry = WIDGET_CATALOG.get(type_id)
    if entry is None:
        raise ValidationError(
            f"Unknown widget type: {type_id}",
            code="UNKNOWN_WIDGET_TYPE",
            details={"widget_type": type_id, "known": list_type_ids()},
        )
    validator = Draft7Validator(entry["params_schema"])
    errors = sorted(validator.iter_errors(params), key=lambda e: list(e.absolute_path))
    if errors:
        raise ValidationError(
            f"Params do not match schema for widget_type={type_id}",
            code="WIDGET_PARAMS_INVALID",
            details={
                "widget_type": type_id,
                "errors": [_format_error(e) for e in errors],
            },
        )


def _format_error(exc: JSONSchemaValidationError) -> dict[str, Any]:
    path = ".".join(str(p) for p in exc.absolute_path)
    return {"path": path, "message": exc.message}
