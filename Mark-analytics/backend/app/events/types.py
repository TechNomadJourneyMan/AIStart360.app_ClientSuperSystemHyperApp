"""Domain event Pydantic models. Stable contract between agents."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class _BaseEvent(BaseModel):
    event_id: UUID = Field(default_factory=uuid4)
    occurred_at: datetime = Field(default_factory=datetime.utcnow)


class CompanyDiscovered(_BaseEvent):
    type: Literal["company_discovered"] = "company_discovered"
    source: str
    external_id: str
    hint_url: str | None = None
    seed_payload: dict[str, Any] = Field(default_factory=dict)


class PageFetched(_BaseEvent):
    type: Literal["page_fetched"] = "page_fetched"
    page_id: UUID
    source: str
    url: str
    http_status: int
    html_r2_key: str | None = None


class EntityExtracted(_BaseEvent):
    type: Literal["entity_extracted"] = "entity_extracted"
    entity_type: Literal["company", "person", "tender"]
    entity_id: UUID
    source_page_id: UUID | None = None
    confidence: float
    fields: dict[str, Any] = Field(default_factory=dict)


class EntityEnriched(_BaseEvent):
    type: Literal["entity_enriched"] = "entity_enriched"
    entity_type: Literal["company", "person", "tender"]
    entity_id: UUID
    additions: dict[str, Any] = Field(default_factory=dict)


class AlertFired(_BaseEvent):
    type: Literal["alert_fired"] = "alert_fired"
    rule_id: UUID
    aggregate_id: UUID
    payload: dict[str, Any] = Field(default_factory=dict)
