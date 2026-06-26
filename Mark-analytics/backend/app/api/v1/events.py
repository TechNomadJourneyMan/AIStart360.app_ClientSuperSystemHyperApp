"""Server-Sent Events stream for real-time UI updates.

Single endpoint:
    GET /events/stream?topics=companies,alerts,ingest

Authentication: JWT via the standard `Authorization: Bearer ...` header.
EventSource in browsers cannot set custom headers natively; clients should
use a small SSE polyfill (e.g. `event-source-polyfill`) or the Fetch-based
`@microsoft/fetch-event-source` library to attach the bearer token.

Reconnect: the standard `Last-Event-Id` request header is honoured and
forwarded to the Redis Streams cursor.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse

from app.billing.tier import get_user_tier
from app.core.deps import CurrentUserDep
from app.events.sse_consumer import stream_events

router = APIRouter()


def _format_sse(event: str, data: str, event_id: str | None = None) -> bytes:
    """Encode a single SSE frame per the WHATWG spec."""
    lines: list[str] = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    # `data:` may not contain raw newlines — split if needed.
    for line in data.splitlines() or [""]:
        lines.append(f"data: {line}")
    lines.append("")  # blank line terminates the frame
    lines.append("")
    return ("\n".join(lines)).encode("utf-8")


@router.get(
    "/stream",
    summary="Server-Sent Events stream of domain events (JWT required)",
    response_class=StreamingResponse,
)
async def events_stream(
    request: Request,
    user: CurrentUserDep,
    topics: Annotated[
        str | None,
        Query(description="Comma-separated subset: companies,alerts,ingest"),
    ] = None,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-Id")] = None,
) -> StreamingResponse:
    tier = await get_user_tier(user)
    topic_list = (
        [t.strip() for t in topics.split(",") if t.strip()] if topics else None
    )

    async def gen() -> AsyncIterator[bytes]:
        # Send a hello frame so the client knows the stream is live.
        yield _format_sse("hello", '{"ok":true}')
        async for evt in stream_events(
            user_id=user.user_id,
            tier=tier,
            topics=topic_list,
            last_event_id=last_event_id,
        ):
            # If the client disconnected, stop pulling from Redis.
            if await request.is_disconnected():
                break
            yield _format_sse(
                event=evt["event"],
                data=evt["data"],
                event_id=evt.get("id"),
            )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            # nginx/Cloudflare-friendly: disable buffering and gzip.
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
