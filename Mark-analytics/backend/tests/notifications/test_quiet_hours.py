"""Quiet-hours predicate tests.

Cases:
* (a) within window — True
* (b) outside window — False
* (c) wrap-around window (22:00 → 07:00)
* (d) DST behavior in a tz that observes DST (Europe/Berlin):
      we assert that the **local wall-clock window** is what's honoured. We
      do NOT cross the DST boundary inside a single window — our zoneinfo
      lookups handle the offset shift automatically by virtue of using
      ``datetime.astimezone``.
"""

from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.notifications.quiet_hours import (
    is_in_quiet_hours,
    next_quiet_end,
)
from tests.notifications.conftest import make_rule

# ---------------------------------------------------------------------------
# (a) within window


def test_in_window_same_day() -> None:
    rule = make_rule(
        quiet_hours_start=time(9, 0),
        quiet_hours_end=time(17, 0),
        timezone="Asia/Almaty",
    )
    now = datetime(2026, 5, 28, 12, 30, tzinfo=ZoneInfo("Asia/Almaty"))
    assert is_in_quiet_hours(rule, now) is True


# (b) outside window


def test_outside_window_same_day() -> None:
    rule = make_rule(
        quiet_hours_start=time(9, 0),
        quiet_hours_end=time(17, 0),
        timezone="Asia/Almaty",
    )
    morning = datetime(2026, 5, 28, 8, 59, tzinfo=ZoneInfo("Asia/Almaty"))
    evening = datetime(2026, 5, 28, 17, 0, tzinfo=ZoneInfo("Asia/Almaty"))
    assert is_in_quiet_hours(rule, morning) is False
    # end is exclusive
    assert is_in_quiet_hours(rule, evening) is False


def test_no_quiet_hours_set_is_never_muted() -> None:
    rule = make_rule()
    now = datetime(2026, 5, 28, 3, 0, tzinfo=ZoneInfo("Asia/Almaty"))
    assert is_in_quiet_hours(rule, now) is False


def test_start_equal_to_end_is_no_op() -> None:
    rule = make_rule(quiet_hours_start=time(9, 0), quiet_hours_end=time(9, 0))
    now = datetime(2026, 5, 28, 9, 0, tzinfo=ZoneInfo("Asia/Almaty"))
    assert is_in_quiet_hours(rule, now) is False


# (c) wrap-around midnight


def test_wrap_around_midnight_after_start() -> None:
    rule = make_rule(
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    late = datetime(2026, 5, 28, 23, 30, tzinfo=ZoneInfo("Asia/Almaty"))
    early = datetime(2026, 5, 29, 6, 0, tzinfo=ZoneInfo("Asia/Almaty"))
    assert is_in_quiet_hours(rule, late) is True
    assert is_in_quiet_hours(rule, early) is True


def test_wrap_around_midnight_outside() -> None:
    rule = make_rule(
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    midday = datetime(2026, 5, 28, 12, 0, tzinfo=ZoneInfo("Asia/Almaty"))
    assert is_in_quiet_hours(rule, midday) is False


# (d) DST — Europe/Berlin observes CEST. We assert the **wall-clock** window
# is honoured on both sides of the spring-forward transition (2026-03-29).


def test_dst_window_honoured_in_berlin_summer_time() -> None:
    rule = make_rule(
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Europe/Berlin",
    )
    # 2026-06-15 23:00 CEST — clearly within a 22:00→07:00 window.
    summer_night = datetime(2026, 6, 15, 23, 0, tzinfo=ZoneInfo("Europe/Berlin"))
    summer_noon = datetime(2026, 6, 15, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
    assert is_in_quiet_hours(rule, summer_night) is True
    assert is_in_quiet_hours(rule, summer_noon) is False


def test_dst_window_honoured_in_berlin_winter_time() -> None:
    rule = make_rule(
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Europe/Berlin",
    )
    # 2026-01-15 23:00 CET — same wall-clock semantics in winter.
    winter_night = datetime(2026, 1, 15, 23, 0, tzinfo=ZoneInfo("Europe/Berlin"))
    assert is_in_quiet_hours(rule, winter_night) is True


# ---------------------------------------------------------------------------
# next_quiet_end


def test_next_quiet_end_same_day_window() -> None:
    rule = make_rule(
        quiet_hours_start=time(9, 0),
        quiet_hours_end=time(17, 0),
        timezone="Asia/Almaty",
    )
    now = datetime(2026, 5, 28, 12, 30, tzinfo=ZoneInfo("Asia/Almaty"))
    end = next_quiet_end(rule, now)
    assert end.hour == 17 and end.minute == 0
    assert end.date() == now.date()


def test_next_quiet_end_wraps_to_next_day() -> None:
    rule = make_rule(
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    now = datetime(2026, 5, 28, 23, 30, tzinfo=ZoneInfo("Asia/Almaty"))
    end = next_quiet_end(rule, now)
    assert end.date() == now.date().replace(day=29)
    assert end.hour == 7


def test_next_quiet_end_wrap_when_after_midnight() -> None:
    rule = make_rule(
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    now = datetime(2026, 5, 29, 3, 0, tzinfo=ZoneInfo("Asia/Almaty"))
    end = next_quiet_end(rule, now)
    # Still today, 07:00
    assert end.date() == now.date()
    assert end.hour == 7
