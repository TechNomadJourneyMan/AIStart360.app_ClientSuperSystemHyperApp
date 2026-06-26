"""Search API schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str
    filters: dict[str, Any] = Field(default_factory=dict)
    mode: Literal["semantic", "lexical", "hybrid"] = "hybrid"
    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = None


class SearchHit(BaseModel):
    entity_type: Literal["company", "tender", "person"]
    id: str
    score: float
    snippet: str | None = None
    highlights: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    hits: list[SearchHit]
    parsed_filters: dict[str, Any] = Field(default_factory=dict)
    mode_used: str
    took_ms: int
