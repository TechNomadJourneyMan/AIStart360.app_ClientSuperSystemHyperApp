"""Supabase JWT verification (HS256 via shared secret).

For prod hardening you may switch to RS256/JWKS — Supabase exposes:
  GET ${SUPABASE_URL}/auth/v1/keys
Here we use the simpler shared-secret flow which Supabase provides
in Settings → API → JWT Secret.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt

from app.config import settings
from app.core.errors import UnauthorizedError


@dataclass(slots=True)
class SupabaseUserClaims:
    user_id: str
    email: str | None
    role: str
    app_metadata: dict[str, Any]
    user_metadata: dict[str, Any]
    raw: dict[str, Any]


def verify_supabase_jwt(token: str) -> SupabaseUserClaims:
    if not settings.SUPABASE_JWT_SECRET:
        raise UnauthorizedError("Supabase JWT secret not configured", code="AUTH_NOT_CONFIGURED")

    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise UnauthorizedError("Token expired", code="TOKEN_EXPIRED") from e
    except jwt.InvalidAudienceError as e:
        raise UnauthorizedError("Invalid audience", code="INVALID_AUDIENCE") from e
    except jwt.InvalidTokenError as e:
        raise UnauthorizedError(f"Invalid token: {e}", code="INVALID_TOKEN") from e

    return SupabaseUserClaims(
        user_id=str(payload["sub"]),
        email=payload.get("email"),
        role=payload.get("role", "authenticated"),
        app_metadata=payload.get("app_metadata", {}) or {},
        user_metadata=payload.get("user_metadata", {}) or {},
        raw=payload,
    )
