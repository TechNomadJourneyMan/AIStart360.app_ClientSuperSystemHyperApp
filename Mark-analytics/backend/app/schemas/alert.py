"""Alert API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AlertChannel(BaseModel):
    type: str               # 'telegram' | 'email' | 'webhook'
    target: str
    throttle: str | None = None


class AlertRuleCreate(BaseModel):
    name: str
    filter: dict[str, Any]
    channels: list[AlertChannel] = Field(min_length=1)
    enabled: bool = True


class AlertRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    name: str
    filter: dict[str, Any]
    channels: list[dict[str, Any]]
    enabled: bool
    created_at: datetime


class AlertEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    rule_id: UUID
    aggregate_id: UUID
    payload: dict[str, Any]
    fired_at: datetime
    delivered_at: datetime | None = None
