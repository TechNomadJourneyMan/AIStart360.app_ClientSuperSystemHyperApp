"""The curated serverless read-API builds and exposes the read routes.

Mirrors production: api/index.py sets SERVERLESS=true BEFORE importing the app,
so the full eager router aggregation in app.api.v1.__init__ is skipped and only
the curated (dependency-light) read routers load.
"""

from __future__ import annotations

import sys


def _fresh_read_app(monkeypatch):
    monkeypatch.setenv("SERVERLESS", "true")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/mark")
    # Drop any cached app.* so app.api.v1.__init__ re-runs under SERVERLESS=true.
    for name in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[name]
    from app.api.v1.read_api import build_read_app

    return build_read_app()


def test_read_app_builds_and_has_read_routes(monkeypatch):
    app = _fresh_read_app(monkeypatch)
    paths = set(app.openapi().get("paths", {}).keys())

    assert "/health" in paths
    assert any(p.startswith("/api/v1/geo") for p in paths), "geo router (map) must load"
    assert any(
        p.startswith("/api/v1/competitors") for p in paths
    ), "competitors router (niche calculator) must load"
    assert any(p.startswith("/api/v1/analytics") for p in paths)
    assert any(p.startswith("/api/v1/widgets") for p in paths)


def test_read_app_excludes_heavy_routers(monkeypatch):
    """Crawler/worker/AI routers must NOT be mounted in the slim runtime."""
    app = _fresh_read_app(monkeypatch)
    paths = set(app.openapi().get("paths", {}).keys())
    for heavy in ("/api/v1/admin", "/api/v1/uploads", "/api/v1/digests", "/api/v1/analyst"):
        assert not any(p.startswith(heavy) for p in paths), f"{heavy} must be excluded"
