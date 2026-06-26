"""Widget catalog + builder package (Track G).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.

The catalog is the single source of truth for which widget types exist,
their human metadata, and their JSON-schema for params. Per-user widget
records live in `app.models.user_widget.UserWidget`; the service layer
in `app.services.widgets` validates writes against the catalog schema.
"""

from app.widgets.catalog import (
    WIDGET_CATALOG,
    WidgetType,
    get_catalog,
    get_type,
    list_type_ids,
    validate_params,
)

__all__ = [
    "WIDGET_CATALOG",
    "WidgetType",
    "get_catalog",
    "get_type",
    "list_type_ids",
    "validate_params",
]
