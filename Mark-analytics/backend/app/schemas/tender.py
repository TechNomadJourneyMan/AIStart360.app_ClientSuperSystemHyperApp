"""Tender API schemas."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TenderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    external_id: str
    source: str
    title: str
    description: str | None = None
    amount_usd: Decimal | None = None
    currency: str | None = None
    status: str | None = None
    published_at: datetime | None = None
    deadline_at: datetime | None = None
    customer_id: UUID | None = None
    awarded_to_id: UUID | None = None
