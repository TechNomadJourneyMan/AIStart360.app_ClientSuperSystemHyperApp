"""``get_recent_tenders`` — recently published Kazakhstan tenders.

Backed by ``GET /api/v1/tenders/recent``. That endpoint is currently a Phase 0
stub returning an empty envelope; the tool flags ``degraded`` when so.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..client import MarkClient, MarkClientError

NAME = "get_recent_tenders"
DESCRIPTION = (
    "List the most recently published Kazakhstan public-procurement tenders, "
    "optionally filtered by industry and region. Read-only. Currently backed by "
    "a Phase 0 stub; returns `degraded: true` until the tender spider lands."
)


class RecentTendersInput(BaseModel):
    industry: str | None = Field(
        default=None,
        description="OKED industry code or slug to filter on.",
    )
    region: str | None = Field(
        default=None,
        description="KATO region code or short name.",
    )
    limit: int = Field(
        default=10, ge=1, le=50, description="Max tenders to return (1-50)."
    )


INPUT_SCHEMA: dict[str, Any] = RecentTendersInput.model_json_schema()


async def run(client: MarkClient, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        args = RecentTendersInput.model_validate(arguments)
    except ValidationError as exc:
        return {
            "error": "Invalid arguments.",
            "status_code": 422,
            "hint": exc.errors(include_url=False),
        }

    params: dict[str, Any] = {"limit": args.limit}
    if args.industry:
        params["industry"] = args.industry
    if args.region:
        params["region"] = args.region

    try:
        data = await client.get("/api/v1/tenders/recent", params=params)
    except MarkClientError as exc:
        return {
            "error": exc.message,
            "status_code": exc.status_code,
            "hint": exc.hint,
        }

    items: list[Any]
    if isinstance(data, dict):
        items = list(data.get("items") or data.get("data") or [])
    elif isinstance(data, list):
        items = data
    else:
        items = []

    # The backend endpoint is documented as a Phase 0 stub (see
    # backend/app/api/v1/tenders.py "List tenders (stub)"). If we got no items,
    # we surface the degraded state instead of silently returning [].
    if not items:
        return {
            "items": [],
            "total": 0,
            "limit": args.limit,
            "degraded": True,
            "reason": (
                "Mark Analytics /tenders/recent is currently a Phase 0 stub. "
                "Live tender ingestion ships with the procurement spider track."
            ),
        }

    return {
        "items": items,
        "total": len(items),
        "limit": args.limit,
    }
