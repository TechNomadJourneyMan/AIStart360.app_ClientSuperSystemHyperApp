"""Tests for the CDC event listener that powers `companies_changes` (§11 PR #1).

These exercise the diff logic without spinning up Postgres: we mock the bits
of `sqlalchemy.inspect()` the listener actually reads and assert the resulting
`CompanyChange` rows.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.models import _company_cdc
from app.models.company import Company, CompanyChange

# ─── stubs ──────────────────────────────────────────────────────────


class _HistoryStub:
    """Mimic sqlalchemy.orm.AttributeState.history."""

    def __init__(self, old: Any, new: Any, changed: bool = True) -> None:
        self.deleted = [old] if changed else []
        self.added = [new] if changed else []
        self._changed = changed

    def has_changes(self) -> bool:
        return self._changed


class _AttrStub:
    def __init__(self, key: str, old: Any, new: Any, changed: bool = True) -> None:
        self.key = key
        self.history = _HistoryStub(old, new, changed)


class _StateStub:
    def __init__(self, modified: bool, attrs: list[_AttrStub]) -> None:
        self.modified = modified
        self.attrs = attrs


class _SessionStub:
    """Replaces the SQLAlchemy session for the listener call."""

    def __init__(self, dirty: list[Any]) -> None:
        self.dirty = dirty
        self.info: dict[str, Any] = {}
        self.added: list[Any] = []

    def add(self, obj: Any) -> None:
        self.added.append(obj)


# ─── helpers ────────────────────────────────────────────────────────


def _patch_inspect(monkeypatch: pytest.MonkeyPatch, mapping: dict[int, _StateStub]) -> None:
    """Force `inspect(obj)` in _company_cdc to return our stub for obj's id."""

    def fake_inspect(obj: Any) -> Any:
        return mapping.get(id(obj))

    monkeypatch.setattr(_company_cdc, "inspect", fake_inspect)


def _make_company(**overrides: Any) -> Company:
    """A real Company instance — we never persist it."""
    cid = overrides.pop("id", uuid.uuid4())
    c = Company(id=cid, country=overrides.pop("country", "KZ"),
                name=overrides.pop("name", "demo"),
                name_normalized=overrides.pop("name_normalized", "demo"))
    for k, v in overrides.items():
        setattr(c, k, v)
    return c


# ─── tests ──────────────────────────────────────────────────────────


def test_one_row_per_changed_field(monkeypatch: pytest.MonkeyPatch) -> None:
    """Updating 2 fields → exactly 2 CompanyChange rows queued."""
    company = _make_company()
    state = _StateStub(
        modified=True,
        attrs=[
            _AttrStub("name", "Old Name", "New Name"),
            _AttrStub("phone", "+7-700-000-0000", "+7-700-111-2222"),
        ],
    )
    _patch_inspect(monkeypatch, {id(company): state})

    session = _SessionStub(dirty=[company])
    _company_cdc.set_change_source(session, "spider")  # type: ignore[arg-type]
    _company_cdc._emit_company_changes(session, None, None)  # type: ignore[arg-type]

    rows: list[CompanyChange] = [r for r in session.added if isinstance(r, CompanyChange)]
    assert len(rows) == 2
    fields = {r.field for r in rows}
    assert fields == {"name", "phone"}
    assert all(r.change_source == "spider" for r in rows)
    assert all(r.company_id == company.id for r in rows)


def test_no_row_for_unchanged_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """Attributes whose history has no changes are skipped."""
    company = _make_company()
    state = _StateStub(
        modified=True,
        attrs=[
            _AttrStub("name", None, None, changed=False),
            _AttrStub("phone", "old", "new", changed=True),
        ],
    )
    _patch_inspect(monkeypatch, {id(company): state})

    session = _SessionStub(dirty=[company])
    _company_cdc._emit_company_changes(session, None, None)  # type: ignore[arg-type]

    rows = [r for r in session.added if isinstance(r, CompanyChange)]
    assert len(rows) == 1
    assert rows[0].field == "phone"


def test_ignored_fields_never_emit_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """`updated_at`, `created_at`, `embedding`, `data_freshness_at` are ignored."""
    company = _make_company()
    attrs = [_AttrStub(field, "old", "new") for field in _company_cdc._IGNORED_FIELDS]
    attrs.append(_AttrStub("name", "x", "y"))
    state = _StateStub(modified=True, attrs=attrs)
    _patch_inspect(monkeypatch, {id(company): state})

    session = _SessionStub(dirty=[company])
    _company_cdc._emit_company_changes(session, None, None)  # type: ignore[arg-type]

    rows = [r for r in session.added if isinstance(r, CompanyChange)]
    assert len(rows) == 1
    assert rows[0].field == "name"


def test_default_change_source_is_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    """If nobody tagged the session, every row gets 'unknown'."""
    company = _make_company()
    state = _StateStub(
        modified=True,
        attrs=[_AttrStub("status", "active", "liquidated")],
    )
    _patch_inspect(monkeypatch, {id(company): state})

    session = _SessionStub(dirty=[company])
    _company_cdc._emit_company_changes(session, None, None)  # type: ignore[arg-type]

    rows = [r for r in session.added if isinstance(r, CompanyChange)]
    assert len(rows) == 1
    assert rows[0].change_source == "unknown"


def test_non_company_objects_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    """Dirty objects that aren't Company instances are skipped silently."""
    other = SimpleNamespace(id=uuid.uuid4())  # not a Company
    session = _SessionStub(dirty=[other])
    _company_cdc._emit_company_changes(session, None, None)  # type: ignore[arg-type]
    assert session.added == []


def test_coerce_handles_complex_values() -> None:
    """JSON-safe coercion: strs/ints pass through, decimals stringify."""
    from decimal import Decimal

    assert _company_cdc._coerce(None) is None
    assert _company_cdc._coerce("x") == "x"
    assert _company_cdc._coerce(42) == 42
    assert _company_cdc._coerce(Decimal("1.5")) == "1.5"
    assert _company_cdc._coerce([1, 2, 3]) == [1, 2, 3]
    assert _company_cdc._coerce({"k": Decimal("2.0")}) == {"k": "2.0"}


def test_coerce_truncates_large_lists() -> None:
    """Coercion caps lists at 16 items to keep CDC rows lean."""
    big = list(range(1000))
    out = _company_cdc._coerce(big)
    assert isinstance(out, list)
    assert len(out) == 16


def test_old_equals_new_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    """If history.has_changes() returns True but old == new, no row is added."""
    company = _make_company()
    state = _StateStub(
        modified=True,
        attrs=[_AttrStub("name", "same", "same")],
    )
    _patch_inspect(monkeypatch, {id(company): state})

    session = _SessionStub(dirty=[company])
    _company_cdc._emit_company_changes(session, None, None)  # type: ignore[arg-type]

    rows = [r for r in session.added if isinstance(r, CompanyChange)]
    assert rows == []
