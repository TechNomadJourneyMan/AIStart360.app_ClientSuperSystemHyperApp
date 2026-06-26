"""Application-level CDC for the `companies` table.

Hooks into SQLAlchemy's `before_flush` to diff dirty `Company` instances against
their committed values and emit one `CompanyChange` row per modified field. We
intentionally avoid a DB trigger here — see ADR-0011 — because:

1. We want the same code path under tests (sqlite or pg).
2. The author of a change is an application concern (who/what wrote it).
3. Rollback is `git revert` rather than a DB migration.

The change_source defaults to `'unknown'` but callers may stamp a value on the
session via `set_change_source(session, "spider")` before flushing.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.company import Company, CompanyChange

# Fields we never want to log as a "real" content change. Audit/timestamp
# columns flap on every UPDATE and pollute the timeline.
_IGNORED_FIELDS: frozenset[str] = frozenset({
    "updated_at",
    "created_at",
    "embedding",  # 1024-dim vector noise
    "data_freshness_at",  # touched on every spider visit
})

_CHANGE_SOURCE_KEY = "_mark_change_source"


def set_change_source(session: Session, source: str) -> None:
    """Tag every CDC row emitted on this session's next flush."""
    session.info[_CHANGE_SOURCE_KEY] = source


def _coerce(value: Any) -> Any:
    """JSON-safe coercion for old/new payloads."""
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        # Don't blow the row up with huge arrays; truncate to 16.
        return [_coerce(v) for v in value[:16]]
    if isinstance(value, dict):
        return {k: _coerce(v) for k, v in value.items()}
    # date / Decimal / UUID — stringify; jsonb accepts strings just fine.
    return str(value)


@event.listens_for(Session, "before_flush")
def _emit_company_changes(session: Session, _flush_ctx: Any, _instances: Any) -> None:
    """Diff every dirty Company and append CompanyChange rows."""
    change_source: str = session.info.get(_CHANGE_SOURCE_KEY) or "unknown"

    new_changes: list[CompanyChange] = []
    for obj in session.dirty:
        if not isinstance(obj, Company):
            continue
        state = inspect(obj)
        if state is None or not state.modified:
            continue
        for attr in state.attrs:
            if attr.key in _IGNORED_FIELDS:
                continue
            history = attr.history
            if not history.has_changes():
                continue
            # `history.deleted` holds the committed value, `history.added` the new.
            old_val = history.deleted[0] if history.deleted else None
            new_val = history.added[0] if history.added else None
            if old_val == new_val:
                continue
            new_changes.append(
                CompanyChange(
                    company_id=obj.id,
                    field=attr.key,
                    old_value={"v": _coerce(old_val)},
                    new_value={"v": _coerce(new_val)},
                    change_source=change_source,
                )
            )
    for ch in new_changes:
        session.add(ch)
