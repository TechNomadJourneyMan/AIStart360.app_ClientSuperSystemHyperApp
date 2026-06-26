"""Outbox publisher: drains `domain_events` to Redis Streams. Run from worker cron."""

from __future__ import annotations

import json

import redis.asyncio as redis_aio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.logging import get_logger
from app.models.domain_event import DomainEvent

logger = get_logger("events.bus")

STREAM_PREFIX = "events"


async def publish_pending(session: AsyncSession, batch: int = 100) -> int:
    """Publish up to `batch` un-published events to Redis Streams. Returns count published."""
    stmt = select(DomainEvent).where(DomainEvent.published_at.is_(None)).limit(batch)
    result = await session.execute(stmt)
    events = list(result.scalars().all())
    if not events:
        return 0

    r = redis_aio.from_url(settings.REDIS_URL, decode_responses=False)
    try:
        for evt in events:
            stream = f"{STREAM_PREFIX}:{evt.event_type}"
            await r.xadd(
                stream,
                {b"id": str(evt.id).encode(), b"payload": json.dumps(evt.payload).encode()},
                maxlen=10_000,
                approximate=True,
            )
        ids = [evt.id for evt in events]
        await session.execute(
            update(DomainEvent).where(DomainEvent.id.in_(ids))
            .values(published_at=DomainEvent.occurred_at)
        )
        await session.commit()
    finally:
        await r.aclose()

    logger.info("events_published", count=len(events))
    return len(events)
