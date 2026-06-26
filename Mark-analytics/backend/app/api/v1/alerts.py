"""Alerts endpoints — Phase 0 CRUD skeleton.

GET endpoints return empty lists (auth-protected).
Mutations return 501 Not Implemented until Phase 4.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.deps import CurrentUserDep
from app.core.errors import AppError, envelope
from app.schemas.alert import AlertRuleCreate

router = APIRouter()


class NotImplementedYetError(AppError):
    code = "NOT_IMPLEMENTED"
    status_code = 501


@router.get("", summary="List alert rules for current user (stub)")
async def list_rules(
    user: CurrentUserDep,
    enabled: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 4."""
    return envelope(
        data=[],
        meta={
            "total": 0,
            "limit": limit,
            "stub": True,
            "user_id": user.user_id,
            "filter_enabled": enabled,
        },
    )


@router.post("", summary="Create alert rule (stub)", status_code=501)
async def create_rule(
    payload: AlertRuleCreate,
    user: CurrentUserDep,
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 4."""
    raise NotImplementedYetError(
        "Creating alert rules is not implemented yet (Phase 0 stub)",
        code="NOT_IMPLEMENTED",
        status_code=501,
        details={"user_id": user.user_id, "received_name": payload.name},
    )


@router.get("/events", summary="Alert fire journal (stub)")
async def list_events(
    user: CurrentUserDep,
    rule_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 4."""
    return envelope(
        data=[],
        meta={
            "total": 0,
            "limit": limit,
            "stub": True,
            "user_id": user.user_id,
            "rule_id": str(rule_id) if rule_id else None,
        },
    )


@router.delete("/{rule_id}", summary="Delete alert rule (stub)", status_code=501)
async def delete_rule(
    rule_id: UUID,
    user: CurrentUserDep,
) -> dict[str, Any]:
    """Stub. Full implementation in Phase 4."""
    raise NotImplementedYetError(
        f"Deleting alert rule {rule_id} is not implemented yet (Phase 0 stub)",
        code="NOT_IMPLEMENTED",
        status_code=501,
        details={"rule_id": str(rule_id), "user_id": user.user_id},
    )
