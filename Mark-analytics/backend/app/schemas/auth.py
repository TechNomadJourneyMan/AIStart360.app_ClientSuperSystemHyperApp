"""Auth-related schemas (read-only — auth itself is Supabase's job)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    plan: str
    org_id: UUID | None = None
    role: str
    requests_used: int
    requests_limit: int
    created_at: datetime


class UserSync(BaseModel):
    """Body for POST /auth/sync — minimal."""
    pass
