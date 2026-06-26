"""Uploads endpoints — see docs/aistart360/04-uploads-and-moderation.md."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.billing.tier import get_user_tier
from app.core.deps import CurrentUserDep
from app.core.errors import NotFoundError, envelope
from app.uploads.service import uploads_service

router = APIRouter()


@router.post("", summary="Upload a file for analysis")
async def create_upload(
    user: CurrentUserDep,
    file: UploadFile = File(...),
    visibility: str = Form("private"),
) -> dict[str, Any]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    tier = await get_user_tier(user)
    rec = await uploads_service.accept(
        user_id=user.user_id,
        tier=tier,
        filename=file.filename or "upload.bin",
        content_type=file.content_type,
        data=data,
    )
    rec.visibility = visibility  # type: ignore[assignment]
    return envelope(data=_serialize(rec))


@router.get("", summary="List my uploads")
async def list_uploads(user: CurrentUserDep) -> dict[str, Any]:
    items = uploads_service.list_for(user.user_id)
    return envelope(data=[_serialize(r) for r in items])


@router.get("/{upload_id}", summary="Get one upload")
async def get_upload(upload_id: str, user: CurrentUserDep) -> dict[str, Any]:
    rec = uploads_service.get(upload_id)
    if not rec or rec.user_id != user.user_id:
        raise NotFoundError("Upload not found", code="UPLOAD_NOT_FOUND")
    return envelope(data=_serialize(rec))


def _serialize(rec: Any) -> dict[str, Any]:
    return {
        "upload_id": rec.upload_id,
        "filename": rec.filename,
        "size_bytes": rec.size_bytes,
        "content_type": rec.content_type,
        "status": rec.status,
        "visibility": rec.visibility,
        "storage_key": rec.storage_key,
        "sha256": rec.sha256,
        "created_at": rec.created_at.isoformat(),
    }
