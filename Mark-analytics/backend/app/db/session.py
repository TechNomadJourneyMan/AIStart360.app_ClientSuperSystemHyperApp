"""Async SQLAlchemy engine + session factory.

Pooler in transaction mode (Supabase) does NOT support prepared statements,
so we set statement_cache_size=0 in connect_args.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


def _make_engine() -> AsyncEngine:
    connect_args: dict[str, object] = {}
    # Supabase pooler (transaction mode) cannot use server-side prepared statements
    if "pooler.supabase.com" in settings.DATABASE_URL:
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0

    return create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        connect_args=connect_args,
    )


engine: AsyncEngine = _make_engine()

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)
