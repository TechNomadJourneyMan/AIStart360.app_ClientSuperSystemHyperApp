"""``search_companies`` — keyword + facet search against ``GET /api/v1/companies``.

Spec: ``docs/aistart360/08-world-monitor-feature-parity.md`` §5 Track D.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..client import MarkClient, MarkClientError

NAME = "search_companies"
DESCRIPTION = (
    "Search Kazakhstan companies by free-text query and optional industry / region "
    "/ size facets. Returns up to `limit` matches with id, BIN, name, industry, "
    "region, size bucket, and a brief description. Read-only."
)


class SearchCompaniesInput(BaseModel):
    query: str = Field(description="Free-text search across name, description, BIN.")
    industry: str | None = Field(
        default=None,
        description="OKED industry code or short slug (e.g. '62' for IT services).",
    )
    region: str | None = Field(
        default=None,
        description="KATO region code or short name (e.g. 'almaty', 'astana').",
    )
    size: str | None = Field(
        default=None,
        description="Company size bucket: 'micro', 'small', 'medium', 'large'.",
    )
    limit: int = Field(
        default=20, ge=1, le=100, description="Max results to return (1-100)."
    )


INPUT_SCHEMA: dict[str, Any] = SearchCompaniesInput.model_json_schema()


async def run(client: MarkClient, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        args = SearchCompaniesInput.model_validate(arguments)
    except ValidationError as exc:
        return {
            "error": "Invalid arguments.",
            "status_code": 422,
            "hint": exc.errors(include_url=False),
        }

    params: dict[str, Any] = {
        "q": args.query,
        "limit": args.limit,
    }
    if args.industry:
        params["industry"] = args.industry
    if args.region:
        params["region"] = args.region
    if args.size:
        params["size"] = args.size

    try:
        data = await client.get("/api/v1/companies", params=params)
    except MarkClientError as exc:
        return {
            "error": exc.message,
            "status_code": exc.status_code,
            "hint": exc.hint,
        }

    # Accept either a list or our standard envelope {items: [...], total: N}.
    if isinstance(data, dict):
        items = data.get("items") or data.get("data") or []
        total = data.get("total")
    else:
        items = data
        total = None

    return {
        "items": items,
        "total": total if total is not None else len(items),
        "limit": args.limit,
    }
