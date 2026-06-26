"""Person API schemas.

Phase-3 persons surface: list filters, detail with role_history aggregation,
and a data_quality envelope. `role_history` is normalized from the JSONB
column on `persons.role_history`; each entry shape is `RoleHistoryEntry`.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RoleHistoryEntry(BaseModel):
    """A single (person, company, role) interval read from JSONB.

    Companies expose their people through this same shape (the `company_id`
    field is just the company on the other end of the link).
    """

    model_config = ConfigDict(extra="ignore")

    company_id: UUID | None = None
    company_name: str | None = None
    role: str | None = None
    started_at: date | None = None
    ended_at: date | None = None
    source: str | None = None


class DataQuality(BaseModel):
    completeness: float = Field(..., ge=0.0, le=1.0)
    missing_fields: list[str] = Field(default_factory=list)


class PersonListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    country: str | None = None
    sanctions: bool = False
    updated_at: datetime


class PersonRead(PersonListItem):
    """Detail response — list fields + role aggregation + data quality.

    `role_history` is ordered by `started_at` desc, with nulls last.
    `current_roles` is the subset where `ended_at is None`.
    """

    iin: str | None = None
    contacts: dict[str, Any] | None = None
    role_history: list[RoleHistoryEntry] = Field(default_factory=list)
    current_roles: list[RoleHistoryEntry] = Field(default_factory=list)
    data_quality: DataQuality


# Backwards-compatible alias kept for older imports.
PersonDetail = PersonRead
