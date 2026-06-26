"""CSV / JSON export of filtered companies."""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from app.core.deps import OptionalUserDep, SessionDep
from app.filters.registry import parse_filters
from app.services.companies import list_companies

router = APIRouter()


@router.get("/companies", summary="Export filtered companies (CSV / JSON)")
async def export_companies(
    request: Request,
    session: SessionDep,
    _user: OptionalUserDep = None,
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    q: str | None = None,
    limit: int = Query(default=1000, ge=1, le=10000),
) -> Response:
    filters = parse_filters(dict(request.query_params))
    rows, _next, _total = await list_companies(session, filters=filters, q=q, limit=limit)

    if format == "json":
        payload = [_serialize(c) for c in rows]
        return Response(
            content=json.dumps(payload, ensure_ascii=False, default=str),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="companies.json"'},
        )

    # CSV
    buf = io.StringIO()
    fieldnames = [
        "id", "bin", "name", "country", "legal_form", "status",
        "industry_code", "industry_label", "registered_at",
        "employee_count", "revenue_usd", "website", "email", "phone",
        "tags", "confidence", "updated_at",
    ]
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for c in rows:
        d = _serialize(c)
        if isinstance(d.get("tags"), list):
            d["tags"] = ",".join(d["tags"])
        writer.writerow(d)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="companies.csv"'},
    )


def _serialize(c: Any) -> dict[str, Any]:
    return {
        "id": str(c.id), "bin": c.bin, "name": c.name, "country": c.country,
        "legal_form": c.legal_form, "status": c.status,
        "industry_code": c.industry_code, "industry_label": c.industry_label,
        "registered_at": c.registered_at.isoformat() if c.registered_at else None,
        "employee_count": c.employee_count,
        "revenue_usd": float(c.revenue_usd) if c.revenue_usd else None,
        "website": c.website, "email": c.email, "phone": c.phone,
        "tags": c.tags or [], "confidence": float(c.confidence) if c.confidence else None,
        "updated_at": c.updated_at.isoformat(),
    }
