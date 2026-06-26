"""Pydantic v2 schemas for the KZ region risk index endpoint."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RegionRiskSubscores(BaseModel):
    """Component subscores feeding the composite risk index.

    Each field is either an integer raw count, or `null` when the source
    table is not yet wired up. The router marks degraded components via
    a sibling `degraded` list on `meta`.
    """

    model_config = ConfigDict(extra="forbid")

    liquidations_3m: int | None = Field(
        description="Companies marked `liquidated` in the last 3 months."
    )
    court_cases_6m: int | None = Field(
        description="Court cases linked to companies in the last 6 months. "
                    "`null` if the `court_cases` table is not yet present.",
    )
    sanctions_hits: int | None = Field(
        description="Sanctions list matches scoped to the region."
    )
    complaints_count: int | None = Field(
        description="Complaints / feedback rows scoped to the region. "
                    "`null` if no complaints table is present.",
    )


class RegionRiskRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kato_code: str
    score: float = Field(ge=0, le=100)
    subscores: RegionRiskSubscores
    updated_at: datetime


__all__ = ["RegionRiskRow", "RegionRiskSubscores"]
