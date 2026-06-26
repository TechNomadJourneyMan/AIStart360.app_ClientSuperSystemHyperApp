"""Shared fixtures for the notifications test suite."""

from __future__ import annotations

import uuid
from datetime import time
from types import SimpleNamespace
from typing import Any

import pytest

from app.models.alert import ChannelKind


def make_rule(
    *,
    channel_kind: ChannelKind | None = None,
    channel_config: dict[str, Any] | None = None,
    quiet_hours_start: time | None = None,
    quiet_hours_end: time | None = None,
    timezone: str = "Asia/Almaty",
    enabled: bool = True,
    name: str = "test-rule",
) -> SimpleNamespace:
    """Duck-type :class:`AlertRule` without touching SQLAlchemy."""
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name=name,
        filter={},
        channels=[],
        enabled=enabled,
        quiet_hours_start=quiet_hours_start,
        quiet_hours_end=quiet_hours_end,
        timezone=timezone,
        channel_kind=channel_kind,
        channel_config=channel_config,
    )


@pytest.fixture
def rule_factory():
    return make_rule
