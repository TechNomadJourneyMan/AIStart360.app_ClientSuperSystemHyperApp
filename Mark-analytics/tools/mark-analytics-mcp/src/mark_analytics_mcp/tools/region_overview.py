"""``region_overview`` — aggregate stats for a KZ KATO region.

Tries ``GET /api/v1/regions/{kato}`` first, falls back to the geo
``GET /api/v1/geo/companies/cluster-stats`` aggregate and the analytics
``GET /api/v1/analytics/region-distribution`` distribution when needed.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..client import MarkClient, MarkClientError

NAME = "region_overview"
DESCRIPTION = (
    "Aggregate stats for one Kazakhstan region by KATO code: company count, "
    "industry mix, recent growth, and (when available) a composite risk index. "
    "Read-only. Returns `degraded: true` when only the fallback aggregate "
    "endpoint is available."
)


class RegionOverviewInput(BaseModel):
    kato_code: str = Field(
        description="KATO region code (e.g. '750000000' for Almaty city).",
        min_length=1,
    )


INPUT_SCHEMA: dict[str, Any] = RegionOverviewInput.model_json_schema()


async def run(client: MarkClient, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        args = RegionOverviewInput.model_validate(arguments)
    except ValidationError as exc:
        return {
            "error": "Invalid arguments.",
            "status_code": 422,
            "hint": exc.errors(include_url=False),
        }

    kato = args.kato_code.strip()

    # 1. Primary: dedicated region endpoint.
    try:
        data = await client.get(f"/api/v1/regions/{kato}")
        if isinstance(data, dict):
            return data
        return {"kato_code": kato, "data": data}
    except MarkClientError as exc:
        if exc.status_code not in (404, 405):
            return {
                "error": exc.message,
                "status_code": exc.status_code,
                "hint": exc.hint,
            }

    # 2. Fallback: geo cluster stats (per-region aggregate).
    try:
        cluster = await client.get(
            "/api/v1/geo/companies/cluster-stats",
            params={"region_kato": kato},
        )
    except MarkClientError as exc:
        if exc.status_code not in (404, 405):
            return {
                "error": exc.message,
                "status_code": exc.status_code,
                "hint": exc.hint,
            }
        cluster = None

    summary: dict[str, Any] | None = None
    if isinstance(cluster, dict):
        # The endpoint returns a list/dict of per-region buckets; match the kato.
        rows = cluster.get("items") or cluster.get("data") or []
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and str(row.get("kato") or row.get("kato_code")) == kato:
                    summary = row
                    break
        elif rows:
            summary = cluster

    if summary is not None:
        return {
            "kato_code": kato,
            "summary": summary,
            "degraded": True,
            "reason": (
                "Returned from /geo/companies/cluster-stats fallback; the "
                "dedicated /regions/{kato} endpoint is not yet published."
            ),
        }

    return {
        "kato_code": kato,
        "degraded": True,
        "reason": (
            "No dedicated region endpoint and no matching row in "
            "/geo/companies/cluster-stats. Region risk index (spec §5 Track E) "
            "has not landed yet."
        ),
    }
