"""Quiet-hours-aware alert dispatcher.

Public entry point: :func:`dispatch`. Given a rule and a payload it either:

* delivers immediately via the registered :class:`Deliverer` for the rule's
  channel kind, returning a :class:`DeliveryResult`; or
* if the rule is currently in quiet hours, persists the payload in
  ``pending_alerts`` with ``scheduled_for`` set to the next quiet-window
  exit and returns a "deferred" result.

The Arq cron task :func:`app.workers.tasks.alerts.release_pending_alerts`
picks up due rows every 5 minutes and re-invokes the dispatcher with
quiet-hours bypassed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import AlertRule, PendingAlert
from app.notifications.base import DeliveryResult
from app.notifications.quiet_hours import is_in_quiet_hours, next_quiet_end
from app.notifications.registry import get_deliverer


async def dispatch(
    session: AsyncSession,
    rule: AlertRule,
    payload: dict[str, Any],
    *,
    now: datetime | None = None,
    bypass_quiet_hours: bool = False,
) -> DeliveryResult:
    """Deliver or defer ``payload`` for ``rule``.

    The caller is responsible for committing the session — we only ``flush``
    so the inserted ``PendingAlert`` is visible if the caller wraps multiple
    dispatches in one transaction.
    """
    if rule.channel_kind is None:
        return DeliveryResult(
            ok=False,
            channel="UNCONFIGURED",
            error="rule has no channel_kind set",
        )

    if not bypass_quiet_hours and is_in_quiet_hours(rule, now):
        scheduled_for = next_quiet_end(rule, now)
        pending = PendingAlert(
            rule_id=rule.id,
            payload=payload,
            scheduled_for=scheduled_for,
        )
        session.add(pending)
        await session.flush()
        return DeliveryResult(
            ok=True,
            channel=rule.channel_kind.value,
            meta={
                "deferred": True,
                "pending_id": str(pending.id),
                "scheduled_for": scheduled_for.isoformat(),
            },
        )

    deliverer = get_deliverer(rule.channel_kind)
    return await deliverer.send(rule, payload)


async def release_due_pending(
    session: AsyncSession, now: datetime | None = None, limit: int = 100
) -> list[tuple[UUID, DeliveryResult]]:
    """Pick due ``pending_alerts`` rows and deliver them.

    Returns a list of ``(pending_id, result)`` tuples. Each successfully
    dispatched row is deleted; rows that fail delivery are left in place so
    the next cron tick retries them.
    """

    if now is None:
        now = datetime.now(UTC)

    stmt = (
        select(PendingAlert)
        .where(PendingAlert.scheduled_for <= now)
        .order_by(PendingAlert.scheduled_for)
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()

    out: list[tuple[UUID, DeliveryResult]] = []
    for pending in rows:
        rule = await session.get(AlertRule, pending.rule_id)
        if rule is None or not rule.enabled:
            await session.delete(pending)
            continue
        result = await dispatch(
            session, rule, pending.payload, now=now, bypass_quiet_hours=True
        )
        out.append((pending.id, result))
        if result.ok and not result.meta.get("deferred"):
            await session.delete(pending)
    await session.flush()
    return out
