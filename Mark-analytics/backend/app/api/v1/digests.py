"""Digest subscription CRUD — Track B.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track B
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from croniter import CroniterBadCronError, croniter
from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUserDep, SessionDep
from app.core.errors import NotFoundError, ValidationError, envelope
from app.models.digest import DigestRun, DigestSubscription
from app.schemas.digest import (
    DigestRunOut,
    DigestSubscriptionCreate,
    DigestSubscriptionOut,
    DigestSubscriptionUpdate,
)
from app.services.digest import run_subscription

router = APIRouter()


def _validate_cron(expr: str) -> None:
    try:
        croniter(expr)
    except (CroniterBadCronError, KeyError, ValueError) as e:
        raise ValidationError(
            f"Invalid cron expression: {expr!r}",
            details={"cron": expr, "error": str(e)},
        ) from e


def _user_uuid(user: Any) -> UUID:
    try:
        return UUID(str(user.user_id))
    except (AttributeError, ValueError) as e:
        raise ValidationError("Invalid user id on auth context") from e


@router.post(
    "",
    summary="Create a digest subscription",
    status_code=status.HTTP_201_CREATED,
)
async def create_digest(
    payload: DigestSubscriptionCreate,
    user: CurrentUserDep,
    session: SessionDep,
) -> dict[str, Any]:
    _validate_cron(payload.schedule_cron)
    sub = DigestSubscription(
        user_id=_user_uuid(user),
        filter_ref=payload.filter_ref,
        name=payload.name,
        channel_kind=payload.channel_kind,
        channel_config=payload.channel_config,
        schedule_cron=payload.schedule_cron,
        timezone=payload.timezone,
        active=payload.active,
        send_when_empty=payload.send_when_empty,
    )
    session.add(sub)
    await session.commit()
    await session.refresh(sub)
    return envelope(data=DigestSubscriptionOut.model_validate(sub).model_dump(mode="json"))


@router.get("", summary="List the current user's digest subscriptions")
async def list_digests(
    user: CurrentUserDep,
    session: SessionDep,
    active: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    stmt = select(DigestSubscription).where(
        DigestSubscription.user_id == _user_uuid(user)
    )
    if active is not None:
        stmt = stmt.where(DigestSubscription.active.is_(active))
    stmt = stmt.order_by(DigestSubscription.created_at.desc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return envelope(
        data=[
            DigestSubscriptionOut.model_validate(r).model_dump(mode="json") for r in rows
        ],
        meta={"total": len(rows), "limit": limit},
    )


@router.get("/{subscription_id}", summary="Get one digest subscription")
async def get_digest(
    subscription_id: UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> dict[str, Any]:
    sub = await _load_owned(session, subscription_id, user)
    return envelope(data=DigestSubscriptionOut.model_validate(sub).model_dump(mode="json"))


@router.patch("/{subscription_id}", summary="Update a digest subscription")
async def update_digest(
    subscription_id: UUID,
    payload: DigestSubscriptionUpdate,
    user: CurrentUserDep,
    session: SessionDep,
) -> dict[str, Any]:
    sub = await _load_owned(session, subscription_id, user)
    data = payload.model_dump(exclude_unset=True)
    if data.get("schedule_cron"):
        _validate_cron(data["schedule_cron"])
    for k, v in data.items():
        setattr(sub, k, v)
    await session.commit()
    await session.refresh(sub)
    return envelope(data=DigestSubscriptionOut.model_validate(sub).model_dump(mode="json"))


@router.delete(
    "/{subscription_id}",
    summary="Delete a digest subscription",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_digest(
    subscription_id: UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> None:
    sub = await _load_owned(session, subscription_id, user)
    await session.delete(sub)
    await session.commit()


@router.post(
    "/{subscription_id}/run-now",
    summary="Trigger a digest run immediately (ignores cron)",
)
async def run_now(
    subscription_id: UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> dict[str, Any]:
    sub = await _load_owned(session, subscription_id, user)
    now = datetime.now(UTC)
    run = await run_subscription(session, sub, now=now)
    session.add(run)
    session.add(sub)
    await session.commit()
    await session.refresh(run)
    return envelope(data=DigestRunOut.model_validate(run).model_dump(mode="json"))


async def _load_owned(
    session: Any, subscription_id: UUID, user: Any
) -> DigestSubscription:
    stmt = select(DigestSubscription).where(
        DigestSubscription.id == subscription_id,
        DigestSubscription.user_id == _user_uuid(user),
    )
    result = await session.execute(stmt)
    sub = result.scalar_one_or_none()
    if sub is None:
        raise NotFoundError(
            f"Digest subscription {subscription_id} not found",
            details={"id": str(subscription_id)},
        )
    return sub


# Expose DigestRun for sibling routers / tests that want to introspect.
__all__ = ["DigestRun", "router"]
