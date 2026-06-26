"""Forecast endpoint schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ForecastType(BaseModel):
    """Listed in GET /forecasts."""

    type: str
    title: str
    description: str


class ForecastMeta(BaseModel):
    """GET /forecasts/{type_slug} — metadata + defaults."""

    type: str
    title: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    defaults: dict[str, Any] = Field(default_factory=dict)


class ForecastRunResult(BaseModel):
    """POST /forecasts/{type_slug} — output of computation."""

    type: str
    output: dict[str, Any]
    chart: dict[str, Any] | list[Any] | None = None


class ForecastSimulateResult(BaseModel):
    """POST /forecasts/{type_slug}/simulate."""

    output: dict[str, Any]
    chart: dict[str, Any] | list[Any] | None = None
