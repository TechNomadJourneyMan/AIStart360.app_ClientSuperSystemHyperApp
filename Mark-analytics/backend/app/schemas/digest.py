"""Digest subscription API schemas — Track B."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ChannelKind = Literal["email", "slack", "discord", "telegram", "webhook"]


class DigestSubscriptionCreate(BaseModel):
    filter_ref: str = Field(..., description="'list:<uuid>' or 'filter:<uuid>'")
    name: str = "Digest"
    channel_kind: ChannelKind = "email"
    channel_config: dict[str, Any] = Field(default_factory=dict)
    schedule_cron: str = Field(..., description="Standard 5-field cron expression")
    timezone: str = "Asia/Almaty"
    active: bool = True
    send_when_empty: bool = False


class DigestSubscriptionUpdate(BaseModel):
    filter_ref: str | None = None
    name: str | None = None
    channel_kind: ChannelKind | None = None
    channel_config: dict[str, Any] | None = None
    schedule_cron: str | None = None
    timezone: str | None = None
    active: bool | None = None
    send_when_empty: bool | None = None


class DigestSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    filter_ref: str
    name: str
    channel_kind: str
    channel_config: dict[str, Any]
    schedule_cron: str
    timezone: str
    active: bool
    send_when_empty: bool
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DigestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    subscription_id: UUID
    started_at: datetime
    finished_at: datetime | None
    item_count: int
    status: str
    error: str | None = None
