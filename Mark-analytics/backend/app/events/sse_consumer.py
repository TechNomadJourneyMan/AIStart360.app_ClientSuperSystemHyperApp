"""Server-Sent Events consumer.

Reads from Redis Streams created by `app.events.bus.publish_pending` and
yields dict envelopes ready to be serialised by the SSE response layer.

The consumer is `xread`-based (no consumer groups) because each SSE connection
is ephemeral and replay is bounded by `Last-Event-Id`. If the caller does not
supply a `last_event_id`, we start from the tail (`$`) so the client only sees
events emitted after subscription.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import redis.asyncio as redis_aio

from app.billing.tier import Tier
from app.config import settings
from app.core.logging import get_logger

logger = get_logger("events.sse")


STREAM_PREFIX = "events"

# Topic groups exposed to clients. Keys map to one or more Redis stream patterns.
# We don't use Redis pattern subscribe (PSUBSCRIBE) because Streams use XREAD on
# named streams; instead we enumerate the concrete stream names per topic.
TOPIC_STREAMS: dict[str, tuple[str, ...]] = {
    "companies": (
        f"{STREAM_PREFIX}:company_discovered",
        f"{STREAM_PREFIX}:entity_enriched",
        f"{STREAM_PREFIX}:entity_extracted",
    ),
    "alerts": (
        f"{STREAM_PREFIX}:alert_fired",
    ),
    "ingest": (
        f"{STREAM_PREFIX}:page_fetched",
        f"{STREAM_PREFIX}:ingest_job_completed",
    ),
}


def _topics_for_tier(tier: Tier) -> set[str]:
    """Return the set of topic names visible to a given tier."""
    if tier in (Tier.PRO, Tier.BUSINESS, Tier.ENTERPRISE):
        return {"companies", "alerts", "ingest"}
    if tier == Tier.STARTER:
        return {"companies", "alerts", "ingest"}
    # FREE — only discovery + their own alerts.
    return {"companies", "alerts"}


def resolve_streams(tier: Tier, requested: list[str] | None) -> list[str]:
    """Map (tier, ?topics=...) to a concrete list of Redis stream names."""
    allowed = _topics_for_tier(tier)
    if requested:
        topics = [t for t in requested if t in allowed]
    else:
        topics = sorted(allowed)
    streams: list[str] = []
    for t in topics:
        streams.extend(TOPIC_STREAMS.get(t, ()))
    # Dedup while preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for s in streams:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _topic_of(stream_name: str) -> str:
    """Reverse-lookup the topic name from a stream name."""
    for topic, names in TOPIC_STREAMS.items():
        if stream_name in names:
            return topic
    return "unknown"


def _filter_for_user(
    user_id: str, tier: Tier, stream: str, payload: dict[str, Any]
) -> bool:
    """RLS: drop events the user shouldn't see.

    - `alert_fired` events are only delivered to the rule owner.
    - All other event types are public to subscribers of that topic.
    """
    if stream.endswith(":alert_fired"):
        owner = (
            payload.get("user_id")
            or payload.get("owner_id")
            or payload.get("rule_owner_id")
        )
        if owner is None:
            # If publisher didn't tag the owner, hide it from FREE/STARTER and
            # only show to PRO+ (who can see system-wide ops feeds).
            return tier in (Tier.PRO, Tier.BUSINESS, Tier.ENTERPRISE)
        return str(owner) == str(user_id)
    return True


async def stream_events(
    user_id: str,
    tier: Tier,
    topics: list[str] | None = None,
    last_event_id: str | None = None,
    *,
    block_ms: int = 30_000,
) -> AsyncIterator[dict[str, Any]]:
    """Yield SSE-ready dicts: ``{"event": topic, "id": "...", "data": json_str}``.

    Heartbeat ``{"event": "ping", "data": "{}"}`` is yielded whenever XREAD
    times out, ensuring the connection stays warm through HTTP proxies.
    """
    streams = resolve_streams(tier, topics)
    if not streams:
        logger.info("sse.no_streams", user_id=user_id, tier=tier.value)
        # Still emit heartbeats so the client connection doesn't drop.
        while True:
            yield {"event": "ping", "data": "{}"}

    # Per-stream cursor. "$" = tail (only new messages from now on).
    cursors: dict[str, str] = {s: (last_event_id or "$") for s in streams}

    r = redis_aio.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        while True:
            try:
                resp = await r.xread(cursors, block=block_ms, count=100)
            except Exception as exc:  # pragma: no cover — Redis hiccup
                logger.warning("sse.xread_error", err=str(exc))
                yield {"event": "ping", "data": "{}"}
                continue

            if not resp:
                # Block timed out → heartbeat.
                yield {"event": "ping", "data": "{}"}
                continue

            for stream_name, messages in resp:
                for msg_id, fields in messages:
                    cursors[stream_name] = msg_id
                    raw_payload = fields.get("payload") or fields.get(b"payload")
                    if isinstance(raw_payload, bytes):
                        raw_payload = raw_payload.decode("utf-8", "replace")
                    try:
                        payload = json.loads(raw_payload) if raw_payload else {}
                    except json.JSONDecodeError:
                        payload = {"_raw": raw_payload}

                    if not _filter_for_user(user_id, tier, stream_name, payload):
                        continue

                    yield {
                        "event": _topic_of(stream_name),
                        "id": msg_id,
                        "data": json.dumps(
                            {
                                "stream": stream_name,
                                "payload": payload,
                            },
                            ensure_ascii=False,
                            default=str,
                        ),
                    }
    finally:
        await r.aclose()
