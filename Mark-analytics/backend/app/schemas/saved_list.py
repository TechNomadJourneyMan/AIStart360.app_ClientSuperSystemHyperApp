"""Pydantic v2 schemas for Saved Companies lists (Track F)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SavedListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SavedListRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SavedListItemCreate(BaseModel):
    company_id: UUID
    note: str | None = Field(default=None, max_length=2000)


class SavedListItemPatch(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class SavedListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    company_id: UUID
    company_name: str | None = None
    company_country: str | None = None
    industry_code: str | None = None
    industry_label: str | None = None
    added_at: datetime
    note: str | None = None


class SavedListSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    item_count: int = 0
    created_at: datetime
    updated_at: datetime


class SavedListDetail(SavedListSummary):
    items: list[SavedListItemOut] = Field(default_factory=list)
