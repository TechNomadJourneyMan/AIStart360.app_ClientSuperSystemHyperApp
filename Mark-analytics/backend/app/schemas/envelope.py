"""Standard response envelope used by every API endpoint."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ErrorEntry(BaseModel):
    code: str
    message: str
    field: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class Meta(BaseModel):
    model_config = ConfigDict(extra="allow")
    request_id: str | None = None
    took_ms: int | None = None


class ResponseEnvelope(BaseModel, Generic[T]):
    data: T | None = None
    meta: Meta = Field(default_factory=Meta)
    errors: list[ErrorEntry] = Field(default_factory=list)
