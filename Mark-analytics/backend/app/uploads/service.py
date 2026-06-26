"""User uploads service — file accept, schema infer stub, status mgmt.

See docs/aistart360/04-uploads-and-moderation.md.

Real R2 client wiring is delegated to the crawl-engineer's `app.storage.r2`
(not yet implemented); we stub a local file writer for dev so the endpoint
is testable end-to-end immediately.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from app.billing.quota import check_and_increment
from app.billing.tier import Tier, quota_for
from app.config import settings
from app.core.errors import ValidationError
from app.core.logging import get_logger

logger = get_logger("uploads")

UploadStatus = Literal[
    "uploading", "analyzing", "mapping_ready", "extracting",
    "ready", "needs_review", "approved", "rejected", "failed",
]

ALLOWED_EXTENSIONS = {".csv", ".tsv", ".xlsx", ".pdf", ".json", ".txt"}


@dataclass(slots=True)
class UploadRecord:
    upload_id: str
    user_id: str
    filename: str
    content_type: str | None
    size_bytes: int
    storage_key: str
    sha256: str
    status: UploadStatus = "uploading"
    visibility: Literal["private", "org", "shared"] = "private"
    mapping_proposal: dict | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class UploadsService:
    """Stub service: persists files locally to ./.cache/uploads in dev.

    In prod, swap the local writer for `app.storage.r2.put_object`.
    """

    def __init__(self) -> None:
        self.root = Path(".cache/uploads")
        self.root.mkdir(parents=True, exist_ok=True)
        self._records: dict[str, UploadRecord] = {}

    async def accept(
        self,
        *,
        user_id: str,
        tier: Tier,
        filename: str,
        content_type: str | None,
        data: bytes,
    ) -> UploadRecord:
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValidationError(
                f"Extension {ext} not allowed. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
                code="UPLOAD_EXT_NOT_ALLOWED",
            )

        q = quota_for(tier)
        max_bytes = q.upload_size_mb * 1024 * 1024
        if len(data) > max_bytes:
            raise ValidationError(
                f"File exceeds tier limit ({q.upload_size_mb} MB on {tier.value})",
                code="UPLOAD_TOO_LARGE",
            )

        await check_and_increment(user_id, tier, "uploads")

        upload_id = str(uuid4())
        sha = hashlib.sha256(data).hexdigest()
        storage_key = f"users/{user_id}/{upload_id}/{filename}"
        target = self.root / storage_key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

        rec = UploadRecord(
            upload_id=upload_id,
            user_id=user_id,
            filename=filename,
            content_type=content_type,
            size_bytes=len(data),
            storage_key=storage_key,
            sha256=sha,
            status="analyzing",
        )
        self._records[upload_id] = rec
        logger.info("upload_accepted", upload_id=upload_id, size=len(data),
                     storage_key=storage_key, sha=sha[:12])
        return rec

    def get(self, upload_id: str) -> UploadRecord | None:
        return self._records.get(upload_id)

    def list_for(self, user_id: str) -> list[UploadRecord]:
        return [r for r in self._records.values() if r.user_id == user_id]


uploads_service = UploadsService()
