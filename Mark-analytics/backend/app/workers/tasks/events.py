"""Arq task: outbox publisher — drains domain_events → Redis Streams."""

from __future__ import annotations

from typing import Any

from app.db.session import async_session_factory
from app.events.bus import publish_pending


async def flush_outbox(ctx: dict[str, Any]) -> dict[str, Any]:
    async with async_session_factory() as session:
        count = await publish_pending(session, batch=200)
    return {"published": count}
