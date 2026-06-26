"""``industry_overview`` — aggregate stats for an OKED industry code.

Tries ``GET /api/v1/analytics/industries/{code}`` first, falls back to the
generic ``GET /api/v1/analytics/industry-distribution`` and filters client-side
when the specific endpoint isn't published yet (Phase 0/1).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..client import MarkClient, MarkClientError

NAME = "industry_overview"
DESCRIPTION = (
    "Aggregate Kazakhstan-wide stats for an OKED industry: company count, "
    "median size, top regions, growth trend. Read-only. Falls back to the "
    "industry-distribution endpoint with `degraded: true` if the dedicated "
    "endpoint is not yet published."
)


class IndustryOverviewInput(BaseModel):
    industry_code: str = Field(
        description="OKED industry code, e.g. '62' (computer programming) or '62.01'.",
        min_length=1,
    )


INPUT_SCHEMA: dict[str, Any] = IndustryOverviewInput.model_json_schema()


async def run(client: MarkClient, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        args = IndustryOverviewInput.model_validate(arguments)
    except ValidationError as exc:
        return {
            "error": "Invalid arguments.",
            "status_code": 422,
            "hint": exc.errors(include_url=False),
        }

    code = args.industry_code.strip()

    # Primary: dedicated industry endpoint.
    try:
        data = await client.get(f"/api/v1/analytics/industries/{code}")
        if isinstance(data, dict):
            return data
        return {"industry_code": code, "data": data}
    except MarkClientError as exc:
        if exc.status_code not in (404, 405):
            return {
                "error": exc.message,
                "status_code": exc.status_code,
                "hint": exc.hint,
            }

    # Fallback: pull the global distribution and pluck the matching row.
    try:
        data = await client.get("/api/v1/analytics/industry-distribution")
    except MarkClientError as exc:
        return {
            "error": exc.message,
            "status_code": exc.status_code,
            "hint": exc.hint,
        }

    rows: list[Any]
    if isinstance(data, dict):
        rows = list(data.get("items") or data.get("data") or [])
    elif isinstance(data, list):
        rows = data
    else:
        rows = []

    match: dict[str, Any] | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_code = str(row.get("code") or row.get("industry_code") or "")
        if row_code == code or row_code.startswith(code):
            match = row
            break

    if match is None:
        return {
            "industry_code": code,
            "degraded": True,
            "reason": (
                "Dedicated /analytics/industries/{code} endpoint not available "
                "and code not present in /analytics/industry-distribution."
            ),
        }

    return {
        "industry_code": code,
        "summary": match,
        "degraded": True,
        "reason": (
            "Returned from /analytics/industry-distribution fallback; the "
            "dedicated industry overview endpoint is not yet published."
        ),
    }
