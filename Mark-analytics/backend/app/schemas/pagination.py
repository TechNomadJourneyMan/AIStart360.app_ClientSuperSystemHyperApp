"""Cursor pagination helpers."""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field

T = TypeVar("T")


class PageMeta(BaseModel):
    cursor_next: str | None = None
    cursor_prev: str | None = None
    limit: int = 20
    total_estimate: int | None = None


class CursorPage(BaseModel, Generic[T]):
    data: list[T] = Field(default_factory=list)
    meta: PageMeta = Field(default_factory=PageMeta)


def encode_cursor(updated_at: datetime, item_id: UUID) -> str:
    raw = f"{updated_at.isoformat()}|{item_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    pad = "=" * (-len(cursor) % 4)
    raw = base64.urlsafe_b64decode(cursor + pad).decode()
    ts_str, id_str = raw.split("|", 1)
    return datetime.fromisoformat(ts_str), UUID(id_str)
