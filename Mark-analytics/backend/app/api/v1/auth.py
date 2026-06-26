"""Auth endpoints. Auth itself = Supabase; we only do me + sync + webhooks."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException

from app.config import settings
from app.core.deps import CurrentUserDep, SessionDep
from app.core.errors import envelope
from app.schemas.auth import UserOut
from app.services.users import ensure_user_exists

router = APIRouter()


@router.get("/me", summary="Current authenticated user (extended profile)")
async def me(user: CurrentUserDep, session: SessionDep) -> dict[str, Any]:
    db_user = await ensure_user_exists(session, user)
    return envelope(data=UserOut.model_validate(db_user).model_dump(mode="json"))


@router.post("/sync", summary="Idempotent provisioning (called once per login)")
async def sync_user(user: CurrentUserDep, session: SessionDep) -> dict[str, Any]:
    db_user = await ensure_user_exists(session, user)
    return envelope(data=UserOut.model_validate(db_user).model_dump(mode="json"))


@router.post("/webhooks/auth", summary="Supabase auth webhook (internal)")
async def webhook_auth(
    payload: dict[str, Any],
    x_supabase_webhook_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    if not settings.SUPABASE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    if x_supabase_webhook_secret != settings.SUPABASE_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")
    # Stub: record audit, no-op handler. Real impl would handle 'INSERT' on auth.users,
    # password reset, etc.
    return envelope(data={"received": True, "type": payload.get("type")})
