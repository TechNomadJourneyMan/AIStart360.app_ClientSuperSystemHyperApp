"""Catalog correctness tests.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track G.
No DB required — pure-Python checks on the catalog dict + its JSON schemas.
"""

from __future__ import annotations

import pytest
from jsonschema import Draft7Validator
from jsonschema.exceptions import SchemaError

from app.widgets.catalog import WIDGET_CATALOG, validate_params

EXPECTED_TYPES = {"metric", "list", "chart", "map_mini", "news", "note"}


def test_catalog_has_six_entries() -> None:
    assert set(WIDGET_CATALOG.keys()) == EXPECTED_TYPES
    assert len(WIDGET_CATALOG) == 6


@pytest.mark.parametrize("type_id", sorted(EXPECTED_TYPES))
def test_each_schema_is_valid_jsonschema(type_id: str) -> None:
    """`Draft7Validator.check_schema` raises if the schema itself is broken."""
    entry = WIDGET_CATALOG[type_id]
    try:
        Draft7Validator.check_schema(entry["params_schema"])
    except SchemaError as exc:  # pragma: no cover - assertion message
        pytest.fail(f"{type_id} schema invalid: {exc.message}")


@pytest.mark.parametrize("type_id", sorted(EXPECTED_TYPES))
def test_default_params_validate(type_id: str) -> None:
    """Each entry's `default_params` must satisfy its own schema."""
    entry = WIDGET_CATALOG[type_id]
    # Will raise ValidationError if the defaults don't match — pytest will
    # fail with a helpful message.
    validate_params(type_id, entry["default_params"])


@pytest.mark.parametrize("type_id", sorted(EXPECTED_TYPES))
def test_entry_has_required_metadata(type_id: str) -> None:
    entry = WIDGET_CATALOG[type_id]
    assert entry["id"] == type_id
    assert entry["name"]
    assert entry["description"]
    assert entry["icon"]
    assert entry["tier"] in {"free", "starter", "pro", "business"}
    assert isinstance(entry["data_sources"], list)


def test_validate_params_rejects_unknown_type() -> None:
    from app.core.errors import ValidationError

    with pytest.raises(ValidationError):
        validate_params("definitely_not_a_widget", {})
