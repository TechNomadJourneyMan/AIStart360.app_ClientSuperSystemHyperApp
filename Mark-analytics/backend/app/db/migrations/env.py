"""Alembic env. Sync mode using DATABASE_URL_DIRECT (or derived from DATABASE_URL)."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.db.base import Base
import app.models  # noqa: F401 — register models for autogenerate

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Resolve sync URL
sync_url = settings.DATABASE_URL_DIRECT or settings.DATABASE_URL.replace("+asyncpg", "")
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata

# Optional isolated schema (e.g. "market") so backend tables never collide with
# the portal's public.* tables in a shared Supabase. None → default (public).
_SCHEMA = settings.DB_SCHEMA


def run_migrations_offline() -> None:
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=_SCHEMA,
        include_schemas=bool(_SCHEMA),
    )
    with context.begin_transaction():
        if _SCHEMA:
            context.execute(f'SET search_path TO "{_SCHEMA}", public')
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        if _SCHEMA:
            # Ensure the isolated schema + pgvector exist, then pin the path so
            # tables, the alembic_version table, and raw SQL all land in it.
            connection.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{_SCHEMA}"')
            connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
            connection.exec_driver_sql(f'SET search_path TO "{_SCHEMA}", public')
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=_SCHEMA,
            include_schemas=bool(_SCHEMA),
        )
        with context.begin_transaction():
            if _SCHEMA:
                context.execute(f'SET search_path TO "{_SCHEMA}", public')
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
