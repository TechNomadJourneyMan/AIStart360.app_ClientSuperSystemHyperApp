"""Vercel Python Function (ASGI) serving /api/* for the Mark-analytics SPA.

Vercel builds the Vite SPA to frontend/dist and routes /api/(.*) here (see
vercel.json). This exposes the dependency-light read-API (map, niche calculator,
insights, widgets, news) against the shared Supabase Postgres — no localhost,
no separate always-on service.
"""

import os
import sys
from pathlib import Path

# Repo layout: Mark-analytics/backend/app/** — make the package importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

# Serverless defaults (overridable via Vercel env).
os.environ.setdefault("SERVERLESS", "true")

from app.api.v1.read_api import build_read_app  # noqa: E402

app = build_read_app()
