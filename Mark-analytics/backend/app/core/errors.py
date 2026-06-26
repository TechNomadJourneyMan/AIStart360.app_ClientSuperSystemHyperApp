"""Application-level error types and FastAPI handlers."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    """Base class for domain errors."""

    code: str = "APP_ERROR"
    status_code: int = 500

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None,
                 details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}


class NotFoundError(AppError):
    code = "NOT_FOUND"
    status_code = 404


class ValidationError(AppError):
    code = "VALIDATION_ERROR"
    status_code = 422


class UnauthorizedError(AppError):
    code = "UNAUTHORIZED"
    status_code = 401


class ForbiddenError(AppError):
    code = "FORBIDDEN"
    status_code = 403


class RateLimitError(AppError):
    code = "RATE_LIMITED"
    status_code = 429


class QuotaExceededError(AppError):
    """Raised when a per-user monthly quota counter would exceed its cap.

    `details` should include `kind`, `used`, `limit`, and `reset_at` so the
    frontend can render an actionable upgrade prompt.
    """

    code = "QUOTA_EXCEEDED"
    status_code = 429

    def __init__(
        self,
        message: str,
        *,
        kind: str,
        used: int,
        limit: int,
        reset_at: str | None = None,
        tier: str | None = None,
        upgrade_url: str = "/pricing",
    ) -> None:
        details: dict[str, Any] = {
            "kind": kind,
            "used": used,
            "limit": limit,
            "reset_at": reset_at,
            "upgrade_url": upgrade_url,
        }
        if tier is not None:
            details["tier"] = tier
        super().__init__(message, details=details)


class TierRequiredError(AppError):
    """Raised when a feature is gated behind a higher subscription tier."""

    code = "TIER_REQUIRED"
    status_code = 402

    def __init__(
        self,
        message: str,
        *,
        tier_required: str,
        tier_current: str,
        upgrade_url: str = "/pricing",
    ) -> None:
        super().__init__(
            message,
            details={
                "tier_required": tier_required,
                "tier_current": tier_current,
                "upgrade_url": upgrade_url,
            },
        )


class AIGatewayUnavailable(AppError):
    code = "AI_UNAVAILABLE"
    status_code = 503


def envelope(*, data: Any = None, errors: list[dict[str, Any]] | None = None,
             meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "data": data,
        "meta": meta or {},
        "errors": errors or [],
    }


async def app_error_handler(request: Request, exc: AppError) -> ORJSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.warning("app_error", code=exc.code, message=exc.message, request_id=request_id)
    return ORJSONResponse(
        status_code=exc.status_code,
        content=envelope(
            errors=[{"code": exc.code, "message": exc.message, **exc.details}],
            meta={"request_id": request_id},
        ),
    )


async def validation_handler(request: Request, exc: RequestValidationError) -> ORJSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return ORJSONResponse(
        status_code=422,
        content=envelope(
            errors=[
                {"code": "VALIDATION_ERROR", "message": str(e["msg"]), "field": ".".join(map(str, e["loc"]))}
                for e in exc.errors()
            ],
            meta={"request_id": request_id},
        ),
    )


async def http_handler(request: Request, exc: StarletteHTTPException) -> ORJSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return ORJSONResponse(
        status_code=exc.status_code,
        content=envelope(
            errors=[{"code": f"HTTP_{exc.status_code}", "message": str(exc.detail)}],
            meta={"request_id": request_id},
        ),
    )


async def unhandled_handler(request: Request, exc: Exception) -> ORJSONResponse:  # pragma: no cover
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.exception("unhandled_error", request_id=request_id)
    return ORJSONResponse(
        status_code=500,
        content=envelope(
            errors=[{"code": "INTERNAL_ERROR", "message": "Internal server error"}],
            meta={"request_id": request_id},
        ),
    )
