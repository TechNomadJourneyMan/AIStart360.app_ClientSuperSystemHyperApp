"""Persist every AI call into ai_call_log. Falls back to structured log if model unavailable."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.session import async_session_factory

logger = get_logger("ai.telemetry")


async def record_call(
    *,
    request_id: str | None,
    agent: str | None,
    task: str,
    model: str,
    provider: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    latency_ms: int,
    cache_hit: bool,
    cache_type: str | None,
    error: str | None = None,
    prompt_version: str | None = None,
    request_fingerprint: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Insert one row into ai_call_log. Never raises — telemetry must not break inference."""

    # Always log first — survives DB unavailability.
    logger.info(
        "ai_call",
        request_id=request_id,
        agent=agent,
        task=task,
        model=model,
        provider=provider,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=round(cost_usd, 6),
        latency_ms=latency_ms,
        cache_hit=cache_hit,
        cache_type=cache_type,
        error=error,
        prompt_version=prompt_version,
    )

    # Try persisting to DB.
    try:
        AICallLog = _try_import_model()
        if AICallLog is None:
            return

        async with async_session_factory() as session:  # type: AsyncSession
            row = AICallLog(
                request_id=_to_uuid(request_id),
                agent=agent,
                task=task,
                model=model,
                provider=provider,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=cost_usd,
                latency_ms=latency_ms,
                cache_hit=cache_hit,
                cache_type=cache_type,
                error=error[:512] if error else None,
                prompt_version=prompt_version,
                request_fingerprint=request_fingerprint,
            )
            session.add(row)
            await session.commit()
    except Exception as e:  # noqa: BLE001
        logger.debug("ai_call_log_persist_failed", err=str(e))


def _try_import_model() -> Any:
    """Lazy import — model may not yet exist during early scaffolding."""
    try:
        from app.models.ai_call_log import AICallLog  # type: ignore[attr-defined]

        return AICallLog
    except Exception:
        return None


def _to_uuid(s: str | None) -> UUID | None:
    if not s:
        return None
    try:
        return UUID(s)
    except (ValueError, TypeError):
        return None


def hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
