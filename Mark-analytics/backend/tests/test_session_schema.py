"""Serverless engine config: NullPool + search_path schema isolation."""

from __future__ import annotations

import importlib

from sqlalchemy.pool import NullPool


def _reload_session(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import app.config as cfg

    importlib.reload(cfg)
    import app.db.session as s

    importlib.reload(s)
    return s


def test_serverless_uses_nullpool(monkeypatch):
    s = _reload_session(
        monkeypatch,
        SERVERLESS="true",
        DATABASE_URL="postgresql+asyncpg://u:p@pooler.supabase.com:6543/postgres",
    )
    assert isinstance(s.engine.pool, NullPool)


def test_search_path_present_when_schema_set(monkeypatch):
    s = _reload_session(
        monkeypatch,
        DB_SCHEMA="market",
        SERVERLESS="false",
        DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/mark",
    )
    assert s._server_settings().get("search_path", "").startswith("market")


def test_no_search_path_by_default(monkeypatch):
    monkeypatch.delenv("DB_SCHEMA", raising=False)
    s = _reload_session(
        monkeypatch,
        DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/mark",
    )
    assert "search_path" not in s._server_settings()
