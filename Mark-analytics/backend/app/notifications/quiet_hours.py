"""Quiet-hours predicate + next-resume computation.

A rule with ``quiet_hours_start`` and ``quiet_hours_end`` defines a window
during which alerts are deferred. Both values are local times in the rule's
``timezone`` (IANA). The window may wrap midnight — e.g. ``22:00 → 07:00``
means "alerts paused between 10pm and 7am, every day."

Semantics:

* If either start or end is ``None``, the rule has no quiet hours and we
  always return ``False``.
* If start == end, we treat it as a degenerate empty window (no muting) —
  this avoids ambiguity with "24-hour mute" which should be expressed as
  ``enabled=False`` on the rule instead.
* Otherwise we compare the current local time-of-day in the rule's tz to
  ``[start, end)``, handling the wrap-around case.

DST: Python's :class:`zoneinfo.ZoneInfo` follows the IANA tzdata, so a rule
in ``"Asia/Almaty"`` (no DST) is unaffected; a rule in ``"Europe/Berlin"``
will correctly shift its window by one hour twice a year. We do **not**
add or subtract an hour at the DST boundary — the local wall-clock window
is what users configured, so during the "spring forward" night the muted
window is one hour shorter, and during "fall back" it's one hour longer.
This matches user intent (their phone alarm clock works the same way).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

if TYPE_CHECKING:
    from app.models.alert import AlertRule


DEFAULT_TZ = "Asia/Almaty"


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TZ)


def _in_window(now_t: time, start: time, end: time) -> bool:
    """Return True if ``now_t`` falls within ``[start, end)`` with wrap-around."""
    if start == end:
        return False
    if start < end:
        # Same-day window, e.g. 09:00..17:00
        return start <= now_t < end
    # Wrap-around window, e.g. 22:00..07:00
    return now_t >= start or now_t < end


def is_in_quiet_hours(rule: AlertRule, now: datetime | None = None) -> bool:
    """Return True iff the rule is currently muted.

    Parameters
    ----------
    rule:
        The :class:`~app.models.alert.AlertRule` to evaluate.
    now:
        Optional aware datetime. Defaults to :func:`datetime.now` in the
        rule's timezone. If a naive datetime is passed it is interpreted in
        the rule's timezone.
    """
    start = rule.quiet_hours_start
    end = rule.quiet_hours_end
    if start is None or end is None:
        return False

    tz = _tz(rule.timezone)
    if now is None:
        now = datetime.now(tz=tz)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    local = now.astimezone(tz)
    return _in_window(local.time(), start, end)


def next_quiet_end(rule: AlertRule, now: datetime | None = None) -> datetime:
    """Return the next datetime at which the rule exits its quiet window.

    If ``now`` is **outside** the quiet window, returns ``now`` unchanged
    (callers should normally check :func:`is_in_quiet_hours` first; this
    function is still safe to call). The result is an aware datetime in the
    rule's timezone.
    """
    tz = _tz(rule.timezone)
    if now is None:
        now = datetime.now(tz=tz)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    local = now.astimezone(tz)

    end = rule.quiet_hours_end
    start = rule.quiet_hours_start
    if end is None or start is None or start == end:
        return local

    # Candidate: today at ``end`` in local tz.
    candidate = datetime.combine(local.date(), end, tzinfo=tz)
    if not is_in_quiet_hours(rule, local):
        return local

    if candidate <= local:
        # End has already passed today; the window must wrap, so the next
        # exit is tomorrow.
        candidate = candidate + timedelta(days=1)
    return candidate
