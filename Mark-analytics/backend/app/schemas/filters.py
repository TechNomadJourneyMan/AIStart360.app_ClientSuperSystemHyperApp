"""Filter catalog schemas — drives the frontend filter UI."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class FilterDefinition(BaseModel):
    """A single filter exposed to the frontend."""

    key: str
    type: str
    values: list[Any] | None = None
    description: str | None = None
    backed_by: str | None = None
