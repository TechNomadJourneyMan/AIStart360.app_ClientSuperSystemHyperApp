"""News endpoints — RSS aggregator over a small set of KZ business feeds."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import envelope
from app.services.news_aggregator import fetch_recent_news_persisted

router = APIRouter()


@router.get("/recent", summary="Recent business news (RSS aggregated + persisted)")
async def recent_news(
    session: SessionDep,
    _user: OptionalUserDep = None,
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    """Return the most recent business news items, merged across configured feeds.

    Fresh RSS items are write-through persisted into `news_items`; the response
    merges fresh + stored items (read-through) ordered by `published_at` desc.
    When every upstream feed fails the stored rows keep the endpoint useful;
    if nothing is available `data` is `[]` and `meta.degraded` is `True`.
    """
    items, meta = await fetch_recent_news_persisted(session, limit=limit)
    return envelope(
        data=[i.as_dict() for i in items],
        meta={
            "total": len(items),
            "limit": limit,
            "cached_at": meta["cached_at"],
            "degraded": meta["degraded"],
            "source": meta["source"],
            "stored_count": meta["stored_count"],
        },
    )
