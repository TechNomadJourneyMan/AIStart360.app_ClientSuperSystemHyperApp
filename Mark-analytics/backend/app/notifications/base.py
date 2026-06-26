"""Abstract delivery contract.

A :class:`Deliverer` takes an :class:`~app.models.alert.AlertRule` and a JSON
payload and ships it to the channel target. Each implementation must be safe
to call concurrently and must not block the event loop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from app.models.alert import AlertRule


@dataclass(slots=True)
class DeliveryResult:
    """Outcome of a single delivery attempt."""

    ok: bool
    channel: str
    status_code: int | None = None
    error: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class Deliverer(Protocol):
    """Async deliverer protocol.

    Implementations must be stateless or hold only configuration — the
    registry caches a single instance per channel kind.
    """

    channel: str

    async def send(
        self, rule: AlertRule, payload: dict[str, Any]
    ) -> DeliveryResult:  # pragma: no cover - protocol
        ...
