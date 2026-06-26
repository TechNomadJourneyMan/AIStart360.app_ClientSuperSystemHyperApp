"""``get_company`` — fetch a single company by UUID or BIN.

Tries ``GET /api/v1/companies/{id}`` first (UUID path); on 404 falls back to
``GET /api/v1/companies?bin={value}&limit=1``.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..client import MarkClient, MarkClientError

NAME = "get_company"
DESCRIPTION = (
    "Fetch a single Kazakhstan company by UUID or by 12-digit BIN. Returns the "
    "full profile (legal name, BIN, OKED, KATO region, registration date, "
    "headcount, contacts) plus any cached AI insights. Read-only."
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_BIN_RE = re.compile(r"^\d{12}$")


class GetCompanyInput(BaseModel):
    id_or_bin: str = Field(
        description="Company UUID (preferred) or 12-digit Kazakhstan BIN.",
        min_length=1,
    )


INPUT_SCHEMA: dict[str, Any] = GetCompanyInput.model_json_schema()


async def run(client: MarkClient, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        args = GetCompanyInput.model_validate(arguments)
    except ValidationError as exc:
        return {
            "error": "Invalid arguments.",
            "status_code": 422,
            "hint": exc.errors(include_url=False),
        }

    value = args.id_or_bin.strip()
    is_uuid = bool(_UUID_RE.match(value))
    is_bin = bool(_BIN_RE.match(value))

    # 1. UUID path — most precise.
    if is_uuid:
        try:
            data = await client.get(f"/api/v1/companies/{value}")
            if isinstance(data, dict):
                return data
            return {"item": data}
        except MarkClientError as exc:
            if exc.status_code != 404:
                return {
                    "error": exc.message,
                    "status_code": exc.status_code,
                    "hint": exc.hint,
                }
            # Fall through to BIN lookup just in case.

    # 2. BIN lookup via list endpoint with bin filter.
    if is_bin or not is_uuid:
        try:
            data = await client.get(
                "/api/v1/companies",
                params={"bin": value, "limit": 1},
            )
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

        if not items:
            return {
                "error": f"Company not found: {value}",
                "status_code": 404,
                "hint": "Pass a valid UUID or a 12-digit BIN.",
            }
        return items[0] if isinstance(items[0], dict) else {"item": items[0]}

    return {
        "error": f"Could not resolve identifier: {value}",
        "status_code": 422,
        "hint": "Pass a UUID or a 12-digit BIN.",
    }
