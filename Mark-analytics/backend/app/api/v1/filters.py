"""Filter catalog endpoint — frontend uses this to render the filter UI."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.core.errors import envelope
from app.filters.registry import list_public_filters
from app.schemas.envelope import ResponseEnvelope
from app.schemas.filters import FilterDefinition

router = APIRouter()


@router.get(
    "",
    summary="List the filter taxonomy supported by /companies, /tenders, /search",
    response_model=ResponseEnvelope[list[FilterDefinition]],
)
async def get_filters() -> dict[str, Any]:
    return envelope(data=list_public_filters())
