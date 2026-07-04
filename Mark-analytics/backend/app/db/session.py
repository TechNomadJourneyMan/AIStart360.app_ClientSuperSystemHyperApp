"""Async SQLAlchemy engine + session factory.

Pooler in transaction mode (Supabase) does NOT support prepared statements,
so we set statement_cache_size=0. On Vercel (SERVERLESS) we use NullPool so
functions never hold a pooled connection across invocations. When DB_SCHEMA is
set, every connection's search_path is pinned to `<schema>,public` so ORM and
raw SQL resolve into the isolated schema without touching model definitions.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings


def _server_settings() -> dict[str, str]:
    """asyncpg server_settings applied to every connection."""
    ss: dict[str, str] = {}
    if settings.DB_SCHEMA:
        # public kept on the path so shared types/extensions (pgvector) resolve.
        ss["search_path"] = f"{settings.DB_SCHEMA},public"
    return ss


def _make_engine() -> AsyncEngine:
    connect_args: dict[str, object] = {}
    use_pooler = "pooler.supabase.com" in settings.DATABASE_URL
    if use_pooler:
        # Supabase pooler (transaction mode) cannot use server-side prepared statements.
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0
    ss = _server_settings()
    if ss:
        connect_args["server_settings"] = ss

    kwargs: dict[str, object] = {"echo": False, "connect_args": connect_args}
    if settings.SERVERLESS or use_pooler:
        # Serverless / pooled: do not hold a client-side pool across invocations.
        kwargs["poolclass"] = NullPool
    else:
        kwargs.update(pool_pre_ping=True, pool_size=5, max_overflow=10)

    return create_async_engine(settings.DATABASE_URL, **kwargs)


engine: AsyncEngine = _make_engine()

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)
