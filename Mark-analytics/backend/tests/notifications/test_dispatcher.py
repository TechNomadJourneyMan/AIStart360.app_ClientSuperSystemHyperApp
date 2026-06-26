"""Dispatcher tests with a fake AsyncSession.

We only exercise the routing logic (quiet-hours defer vs immediate
delivery). Persisting PendingAlert rows is tested as a model-level concern;
here we just assert that ``session.add`` is called with a row whose
``scheduled_for`` matches the expected next_quiet_end value.
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Any
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from app.models.alert import ChannelKind, PendingAlert
from app.notifications.base import DeliveryResult
from app.notifications.dispatcher import dispatch
from tests.notifications.conftest import make_rule


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.flushed = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        self.flushed += 1


async def test_dispatch_immediate_when_outside_quiet_hours() -> None:
    rule = make_rule(
        channel_kind=ChannelKind.SLACK,
        channel_config={"webhook_url": "https://hooks.slack.com/x"},
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    session = _FakeSession()
    now = datetime(2026, 5, 28, 12, 0, tzinfo=ZoneInfo("Asia/Almaty"))

    fake_send = AsyncMock(
        return_value=DeliveryResult(ok=True, channel="SLACK", status_code=200)
    )
    with patch(
        "app.notifications.dispatcher.get_deliverer"
    ) as mock_factory:
        mock_factory.return_value.send = fake_send
        result = await dispatch(session, rule, {"text": "hi"}, now=now)

    assert result.ok is True
    assert result.meta.get("deferred") is not True
    fake_send.assert_awaited_once()
    assert session.added == []  # nothing persisted


async def test_dispatch_defers_when_in_quiet_hours() -> None:
    rule = make_rule(
        channel_kind=ChannelKind.SLACK,
        channel_config={"webhook_url": "https://hooks.slack.com/x"},
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    session = _FakeSession()
    now = datetime(2026, 5, 28, 23, 30, tzinfo=ZoneInfo("Asia/Almaty"))

    fake_send = AsyncMock()
    with patch(
        "app.notifications.dispatcher.get_deliverer"
    ) as mock_factory:
        mock_factory.return_value.send = fake_send
        result = await dispatch(session, rule, {"text": "hi"}, now=now)

    assert result.ok is True
    assert result.meta["deferred"] is True
    fake_send.assert_not_awaited()

    assert len(session.added) == 1
    pending = session.added[0]
    assert isinstance(pending, PendingAlert)
    assert pending.rule_id == rule.id
    assert pending.payload == {"text": "hi"}
    # Scheduled for 07:00 next day (Asia/Almaty)
    assert pending.scheduled_for.date() == now.date().replace(day=29)
    assert pending.scheduled_for.hour == 7


async def test_dispatch_bypass_skips_quiet_hours_check() -> None:
    rule = make_rule(
        channel_kind=ChannelKind.SLACK,
        channel_config={"webhook_url": "https://hooks.slack.com/x"},
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(7, 0),
        timezone="Asia/Almaty",
    )
    session = _FakeSession()
    now = datetime(2026, 5, 28, 23, 30, tzinfo=ZoneInfo("Asia/Almaty"))

    fake_send = AsyncMock(
        return_value=DeliveryResult(ok=True, channel="SLACK")
    )
    with patch(
        "app.notifications.dispatcher.get_deliverer"
    ) as mock_factory:
        mock_factory.return_value.send = fake_send
        result = await dispatch(
            session, rule, {"text": "hi"}, now=now, bypass_quiet_hours=True
        )

    assert result.ok is True
    assert result.meta.get("deferred") is not True
    fake_send.assert_awaited_once()


async def test_dispatch_rejects_rule_without_channel_kind() -> None:
    rule = make_rule(channel_kind=None)
    session = _FakeSession()
    result = await dispatch(session, rule, {"x": 1})
    assert result.ok is False
    assert result.channel == "UNCONFIGURED"
