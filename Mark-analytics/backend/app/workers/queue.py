"""Lazy Arq pool for FastAPI request handlers to enqueue background jobs.

The pool is created on first use and reused for the life of the process.
Callers should treat enqueue failures as best-effort (the trigger sites
already swallow exceptions).
"""

from __future__ import annotations

import asyncio
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import settings

_pool: ArqRedis | None = None
_lock = asyncio.Lock()


async def get_arq_pool() -> ArqRedis:
    global _pool
    if _pool is not None:
        return _pool
    async with _lock:
        if _pool is None:
            _pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    return _pool


async def close_arq_pool() -> None:
    global _pool
    if _pool is not None:
        try:
            await _pool.close(close_connection_pool=True)
        except Exception:  # noqa: S110 — shutdown best-effort
            pass
        _pool = None


def _typing_only() -> Any:  # pragma: no cover
    return ArqRedis
