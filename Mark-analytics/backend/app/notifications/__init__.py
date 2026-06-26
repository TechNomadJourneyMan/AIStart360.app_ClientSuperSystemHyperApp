"""Multi-channel alert delivery (Track C).

Public surface:
    - :class:`Deliverer` — abstract async deliverer.
    - :class:`DeliveryResult` — outcome dataclass.
    - :func:`get_deliverer` — factory by :class:`~app.models.alert.ChannelKind`.
    - :func:`dispatch` — quiet-hours-aware top-level entry.
    - :func:`is_in_quiet_hours` — tz-aware quiet-hours predicate.
"""

from app.notifications.base import Deliverer, DeliveryResult
from app.notifications.dispatcher import dispatch
from app.notifications.quiet_hours import (
    is_in_quiet_hours,
    next_quiet_end,
)
from app.notifications.registry import get_deliverer

__all__ = [
    "Deliverer",
    "DeliveryResult",
    "dispatch",
    "get_deliverer",
    "is_in_quiet_hours",
    "next_quiet_end",
]
