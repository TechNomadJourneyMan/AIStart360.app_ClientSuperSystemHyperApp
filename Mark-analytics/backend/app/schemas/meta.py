"""Schemas for the public `/meta` endpoint.

Exposes a small, public capability snapshot the frontend reads at boot to
decide which modules to render, which forecast types to offer, and which
crawler sources to surface in admin/observability UIs.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ForecastTypeInfo(BaseModel):
    type: str
    title: str
    description: str


class CrawlerSourceInfo(BaseModel):
    key: str
    name: str | None = None
    kind: str | None = None
    enabled: bool = True


class AIModelInfo(BaseModel):
    qualified: str
    provider: str
    active: bool = True


class MetaResponse(BaseModel):
    version: str
    api_prefix: str
    features_enabled: list[str] = Field(default_factory=list)
    available_forecast_types: list[ForecastTypeInfo] = Field(default_factory=list)
    crawler_sources: list[CrawlerSourceInfo] = Field(default_factory=list)
    ai_models_active: list[AIModelInfo] = Field(default_factory=list)
