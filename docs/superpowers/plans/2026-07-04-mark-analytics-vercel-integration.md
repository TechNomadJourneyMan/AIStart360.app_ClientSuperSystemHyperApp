# Mark-analytics → Vercel Full Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal's «Рынок» section (interactive KZ map, niche/TAM-SAM-SOM calculator, market insights, widgets) work in production on Vercel with no localhost and no separately-launched service — by deploying the existing Mark-analytics SPA + a serverless read-API on Vercel, backed by the shared Supabase Postgres.

**Architecture:** One **new Vercel project** built from the monorepo dir `Mark-analytics/` serves BOTH the Vite SPA (static `dist/`) and the FastAPI **read-API** as Vercel Python Functions under `/api`, same origin. The read-API talks to the **shared Supabase Postgres** but into an isolated **`market` schema** (the portal owns `public.companies`, so we must not collide). The portal is unchanged except two env vars + a CSP `frame-src`; its existing `MarketAppEmbed` iframe + postMessage auth/insights bridge already handle the cross-origin embed. Heavy crawler/worker deps (Scrapy/Playwright/fastembed/Neo4j/boto3) are excluded from the function bundle — verified that the read path never imports them. Data = **60 real KZ companies** imported from the owner's Excel (no synthetic).

**Tech Stack:** Vite 6 + React 18 + TanStack Router (frontend); FastAPI + SQLAlchemy 2 async + asyncpg + pgvector (backend, Python 3.12); Vercel Python Functions (Fluid Compute); Supabase Postgres + Auth (JWT); Alembic (migrations).

**What is NOT in scope (deferred, honest empty/stub states as the code already does):** background workers/crawlers (auto data refresh), live tenders/forecasts, Neo4j relationship graph, R2 raw-HTML archive, AI digest/analyst chat, document uploads.

---

## Ground truth established during design

- Portal already defines `public.companies` (Supabase migration `001_onboarding_system.sql:83`; Prisma `Company` `@@map("companies")`). Mark-analytics has its own `companies` table with a totally different shape → **must isolate into a `market` schema**.
- `Mark-analytics/backend/app/main.py` connects nothing at import/startup (only optional Sentry in lifespan). Only `DATABASE_URL` is a hard-required setting; `REDIS_URL` has a default.
- The read path — `app/api/v1/geo.py`, `competitors.py` and `app/services/{geo,competitors}.py` — imports **none** of scrapy/playwright/crawlee/fastembed/neo4j/boto3/trafilatura. Those are confined to crawler/worker modules.
- `app/db/base.py`: single `Base(DeclarativeBase)` with `metadata = MetaData(naming_convention=…)`. → schema isolation is cleanest via connection `search_path`, leaving models/raw-SQL untouched.
- `app/db/session.py`: engine uses `pool_size=5, max_overflow=10` (bad for serverless — needs `NullPool`); already sets `statement_cache_size=0` when `pooler.supabase.com` is in the URL.
- `app/api/v1/__init__.py::_try_include` re-raises a `ModuleNotFoundError` whose missing module is a *transitive* dep (e.g. `scrapy`). So we must NOT include routers that import missing heavy deps → build a **thin entrypoint** including only verified-light routers.
- Frontend `src/services/api.ts`: `API_BASE_URL = VITE_API_BASE_URL ?? 'http://localhost:8000'`. `src/main.tsx`: postMessage origin whitelist uses `VITE_PORTAL_ORIGIN`.
- Seed: `backend/scripts/seed_demo_companies.py` reads `…/kazakhstan_market_data_registry.xlsx` (60 real) and adds `--synthetic N` (default 940). `--synthetic 0` ⇒ **60 real only**. Excel lives on the owner's machine (not in repo).

---

## File Structure (created / modified)

**New (Mark-analytics Vercel project):**
- `Mark-analytics/api/index.py` — thin ASGI entry; Vercel Python Function serving `/api/*`.
- `Mark-analytics/requirements.txt` — slim runtime deps (no crawler/AI/graph libs).
- `Mark-analytics/vercel.json` — build (Vite) + functions (Python) + SPA rewrites + framing headers.
- `Mark-analytics/.vercelignore` — keep `backend/` heavy dirs & `frontend/node_modules` out of the deploy upload.
- `Mark-analytics/frontend/.env.production.example` — documents required `VITE_*`.
- `Mark-analytics/DEPLOY-VERCEL.md` — provisioning runbook.

**Modified (backend, backward-compatible via env defaults):**
- `Mark-analytics/backend/app/config.py` — add `DB_SCHEMA: str | None = None`, `SERVERLESS: bool = False`.
- `Mark-analytics/backend/app/db/session.py` — `NullPool` when serverless/pooler; set `search_path` per connection.
- `Mark-analytics/backend/app/db/migrations/env.py` — `version_table_schema` + create schema + search_path.
- `Mark-analytics/backend/app/api/v1/read_api.py` — **new** curated light-router aggregator (imported by the entry).

**Modified (portal — minimal):**
- `next.config.mjs` (or middleware) — CSP `frame-src`/`connect-src` for the Mark-analytics origin.
- `.env.example` — real guidance for `MARKET_API_URL` + `NEXT_PUBLIC_MARKET_APP_URL`.

**Untouched (owner's work — do NOT edit):** `components/market/MarketAppEmbed.tsx`, the whole `Mark-analytics/frontend/src/**`, `MarketNewsTab.tsx`, `MarketAnalysisChecklist`.

---

## Phase A — Backend serverless adaptation

### Task A1: Add serverless + schema config

**Files:**
- Modify: `Mark-analytics/backend/app/config.py`

- [ ] **Step 1: Add settings** (after the `# ----- Postgres -----` block, near `DATABASE_URL_DIRECT`):

```python
    # ----- Deployment mode / schema isolation -----
    # When embedded in the AIStart360 Supabase, backend tables live in a
    # dedicated schema to avoid colliding with the portal's public.companies.
    # None → default search_path (public), preserving standalone/local behavior.
    DB_SCHEMA: str | None = None
    # Serverless (Vercel Python Functions): use NullPool, no long-lived pool.
    SERVERLESS: bool = False
```

- [ ] **Step 2: Verify import** — `cd Mark-analytics/backend && python -c "from app.config import settings; print(settings.DB_SCHEMA, settings.SERVERLESS)"`
  Expected: `None False`

- [ ] **Step 3: Commit** — `git add Mark-analytics/backend/app/config.py && git commit -m "feat(market-backend): add DB_SCHEMA + SERVERLESS settings"`

### Task A2: Engine — NullPool + search_path

**Files:**
- Modify: `Mark-analytics/backend/app/db/session.py`
- Test: `Mark-analytics/backend/tests/test_session_schema.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_session_schema.py
from sqlalchemy.pool import NullPool
import importlib


def test_serverless_uses_nullpool(monkeypatch):
    monkeypatch.setenv("SERVERLESS", "true")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@pooler.supabase.com:6543/postgres")
    import app.config as cfg
    importlib.reload(cfg)
    import app.db.session as s
    importlib.reload(s)
    assert isinstance(s.engine.pool, NullPool)


def test_search_path_connect_arg_present(monkeypatch):
    monkeypatch.setenv("DB_SCHEMA", "market")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/mark")
    import app.config as cfg
    importlib.reload(cfg)
    import app.db.session as s
    importlib.reload(s)
    # server_settings.search_path is passed to asyncpg
    assert s._server_settings().get("search_path", "").startswith("market")
```

- [ ] **Step 2: Run** — `cd Mark-analytics/backend && pytest tests/test_session_schema.py -q` → FAIL (`_server_settings` missing).

- [ ] **Step 3: Implement** — replace `session.py` body:

```python
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
    ss: dict[str, str] = {}
    if settings.DB_SCHEMA:
        # public kept on the path so shared types/extensions (pgvector) resolve.
        ss["search_path"] = f"{settings.DB_SCHEMA},public"
    return ss


def _make_engine() -> AsyncEngine:
    connect_args: dict[str, object] = {}
    if "pooler.supabase.com" in settings.DATABASE_URL:
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0
    ss = _server_settings()
    if ss:
        connect_args["server_settings"] = ss

    kwargs: dict[str, object] = {"echo": False, "connect_args": connect_args}
    use_pooler = "pooler.supabase.com" in settings.DATABASE_URL
    if settings.SERVERLESS or use_pooler:
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
```

- [ ] **Step 4: Run** — `pytest tests/test_session_schema.py -q` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(market-backend): NullPool + search_path schema isolation"`

### Task A3: Thin read-API entrypoint

**Files:**
- Create: `Mark-analytics/backend/app/api/v1/read_api.py`
- Test: `Mark-analytics/backend/tests/test_read_api_imports.py`

- [ ] **Step 1: Write failing test** — the curated app imports under slim deps and exposes the read routes:

```python
# tests/test_read_api_imports.py
def test_read_app_builds_and_has_read_routes(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/mark")
    from app.api.v1.read_api import build_read_app
    app = build_read_app()
    paths = {r.path for r in app.routes}
    assert "/health" in paths
    assert any(p.startswith("/api/v1/geo") for p in paths)
    assert any(p.startswith("/api/v1/competitors") for p in paths)
```

- [ ] **Step 2: Run** — `pytest tests/test_read_api_imports.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement** — curated router set (ONLY light, read/stub routers verified not to import heavy deps). Each is best-effort so a single unexpectedly-heavy import degrades gracefully instead of crashing the whole function:

```python
# app/api/v1/read_api.py
"""Curated, dependency-light FastAPI app for the Vercel read-API.

Includes ONLY routers whose import graph avoids crawler/worker/AI/graph deps
(scrapy, playwright, crawlee, fastembed, neo4j, boto3). Anything that needs
those (uploads, admin ingest/sources, ai/analyst/digests, events, export) is
intentionally excluded — those features run only on the full always-on backend.
"""
from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app import __version__
from app.config import settings
from app.core.errors import (
    AppError, app_error_handler, http_handler, unhandled_handler, validation_handler,
)
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

# (module_name, prefix, tag) — light read/stub routers only.
READ_ROUTERS: list[tuple[str, str, str]] = [
    ("geo", "/geo", "geo"),
    ("regions", "/regions", "regions"),
    ("competitors", "/competitors", "competitors"),
    ("analytics", "/analytics", "analytics"),
    ("filters", "/filters", "filters"),
    ("saved_lists", "/lists", "lists"),
    ("widgets", "/widgets", "widgets"),
    ("news", "/news", "news"),
    ("persons", "/persons", "persons"),
    ("tenders", "/tenders", "tenders"),
    ("alerts", "/alerts", "alerts"),
    ("trends", "/trends", "trends"),
    ("search", "/search", "search"),
]


def _safe_include(router: APIRouter, module_name: str, prefix: str, tag: str) -> None:
    try:
        mod = __import__(f"app.api.v1.{module_name}", fromlist=["router"])
    except ImportError:
        # Router (or a dep it needs) unavailable in the slim runtime → skip it.
        return
    sub = getattr(mod, "router", None)
    if sub is not None:
        router.include_router(sub, prefix=prefix, tags=[tag])


def build_read_app() -> FastAPI:
    app = FastAPI(
        title="Mark Analytics Read API",
        version=__version__,
        default_response_class=ORJSONResponse,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id", "x-took-ms"],
    )
    app.add_exception_handler(AppError, app_error_handler)          # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_handler)          # type: ignore[arg-type]

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    v1 = APIRouter()
    for name, prefix, tag in READ_ROUTERS:
        _safe_include(v1, name, prefix, tag)
    app.include_router(v1, prefix=settings.API_PREFIX)
    return app
```

- [ ] **Step 4: Run** — `pytest tests/test_read_api_imports.py -q` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(market-backend): thin read-only API app for serverless"`

### Task A4: Vercel Python Function entry

**Files:**
- Create: `Mark-analytics/api/index.py`

- [ ] **Step 1: Implement** — Vercel serves `api/index.py` as a Python Function. Export the ASGI `app`; Vercel's Python runtime supports ASGI apps directly:

```python
# api/index.py — Vercel Python Function (ASGI). Serves /api/* for the SPA.
import os
import sys
from pathlib import Path

# Make the backend package importable (repo layout: Mark-analytics/backend/app)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

os.environ.setdefault("SERVERLESS", "true")

from app.api.v1.read_api import build_read_app  # noqa: E402

app = build_read_app()
```

- [ ] **Step 2: Local smoke** — `cd Mark-analytics && DATABASE_URL=postgresql+asyncpg://u:p@localhost:5432/mark SERVERLESS=true python -c "import sys; sys.path.insert(0,'backend'); from api.index import app; print(type(app).__name__)"`
  Expected: `FastAPI`

- [ ] **Step 3: Commit** — `git commit -am "feat(market): Vercel Python Function entry for read-API"`

---

## Phase B — Vercel project config (frontend + functions)

### Task B1: Slim requirements.txt

**Files:**
- Create: `Mark-analytics/requirements.txt`

- [ ] **Step 1: Write** — runtime deps the read path actually needs (NO scrapy/playwright/crawlee/fastembed/neo4j/boto3/aiobotocore/trafilatura/selectolax/google-genai/sentry/otel):

```text
fastapi>=0.115.0
uvicorn>=0.32.0
pydantic>=2.9.0
pydantic-settings>=2.6.0
sqlalchemy[asyncio]>=2.0.35
asyncpg>=0.29.0
pgvector>=0.3.6
pyjwt[crypto]>=2.9.0
cryptography>=43.0.0
orjson>=3.10.0
structlog>=24.4.0
httpx>=0.27.0
tenacity>=9.0.0
python-slugify>=8.0.0
ulid-py>=1.1.0
tldextract>=5.1.0
phonenumbers>=8.13.0
rapidfuzz>=3.10.0
jsonschema>=4.23.0
feedparser>=6.0.10
python-multipart>=0.0.12
```

- [ ] **Step 2:** Verify a slim venv installs + the app imports (see Task E1). Commit — `git commit -am "feat(market): slim requirements for Vercel functions"`

> **NOTE:** If Task E1 reveals a router in `READ_ROUTERS` imports a package not in this list, either add the (light) package here or drop that router from `READ_ROUTERS`. Log which routers were dropped.

### Task B2: vercel.json

**Files:**
- Create: `Mark-analytics/vercel.json`

- [ ] **Step 1: Write** — build the Vite SPA, expose `api/index.py` as a Python function, rewrite `/api/*` to it and all other paths to the SPA (history routing), and allow the portal to frame the SPA:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "cd frontend && npm ci && npm run build",
  "outputDirectory": "frontend/dist",
  "functions": { "api/index.py": { "runtime": "@vercel/python", "maxDuration": 30 } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'self' https://PORTAL_DOMAIN" }
      ]
    }
  ]
}
```

> Replace `PORTAL_DOMAIN` with the portal's production host (e.g. `aistart360.app`). `frame-ancestors` lets the portal embed this SPA; the SPA's own origin also allowed.

- [ ] **Step 2: Commit** — `git commit -am "feat(market): vercel.json (Vite build + Python API + SPA rewrites)"`

### Task B3: .vercelignore + frontend env template

**Files:**
- Create: `Mark-analytics/.vercelignore`
- Create: `Mark-analytics/frontend/.env.production.example`

- [ ] **Step 1: `.vercelignore`** — keep the heavy backend subtree and node_modules out of the deployment upload (the function only needs `backend/app/**`):

```text
backend/tests
backend/scripts
backend/alembic.ini
backend/uv.lock
backend/.venv
frontend/node_modules
frontend/dist
docs
infra
tools
scripts
```

> Keep `backend/app/**` and `backend/pyproject.toml`? The function installs from root `requirements.txt`, so `pyproject.toml` is not used at build — but do NOT ignore `backend/app`.

- [ ] **Step 2: `frontend/.env.production.example`**:

```text
# Same-origin API (SPA and functions share the Vercel deployment origin).
VITE_API_BASE_URL=/api/v1
# Supabase — SAME project as the portal (shared auth).
VITE_SUPABASE_URL=https://<portal-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<portal anon key>
# Portal production origin — whitelisted for postMessage (session + insights).
VITE_PORTAL_ORIGIN=https://PORTAL_DOMAIN
```

- [ ] **Step 3: Commit** — `git commit -am "chore(market): .vercelignore + frontend prod env template"`

---

## Phase C — Database: schema, migrations, seed

### Task C1: Alembic — target the market schema

**Files:**
- Modify: `Mark-analytics/backend/app/db/migrations/env.py`

- [ ] **Step 1: Implement** — create the schema, pin search_path, and keep alembic's version table in it. In `env.py`, inside both `run_migrations_online`'s connection block and offline config, set:

```python
# after: target_metadata = Base.metadata
from app.config import settings as _settings
_SCHEMA = _settings.DB_SCHEMA  # e.g. "market"; None → public
```

In the online path, before `context.configure(...)`, run DDL and configure schema:

```python
    with connectable.connect() as connection:
        if _SCHEMA:
            connection.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{_SCHEMA}"')
            connection.exec_driver_sql('CREATE EXTENSION IF NOT EXISTS vector')
            connection.exec_driver_sql(f'SET search_path TO "{_SCHEMA}", public')
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=_SCHEMA,        # alembic_version lives in market
            include_schemas=True,
        )
        with context.begin_transaction():
            if _SCHEMA:
                context.execute(f'SET search_path TO "{_SCHEMA}", public')
            context.run_migrations()
```

> If `env.py` uses async engine, apply the same inside the `connection.run_sync(...)` callback. Match the file's existing sync/async shape.

- [ ] **Step 2: Verify SQL generation (no DB needed)** — `cd Mark-analytics/backend && DB_SCHEMA=market DATABASE_URL=postgresql+asyncpg://u:p@localhost:5432/x alembic upgrade head --sql | grep -iE "create schema|search_path|alembic_version" | head`
  Expected: shows `CREATE SCHEMA IF NOT EXISTS "market"` and a market-scoped version table.

- [ ] **Step 3: Commit** — `git commit -am "feat(market-backend): alembic targets isolated market schema"`

### Task C2: Real-only seed guard

**Files:**
- Modify: `Mark-analytics/backend/scripts/seed_demo_companies.py`

- [ ] **Step 1:** Confirm `--synthetic 0` fully skips synthetic generation (read the arg handling). If a value of 0 still generates a default, add an explicit guard so `--synthetic 0` inserts ONLY the 60 real rows. Add a `--real-only` alias that sets synthetic=0.

- [ ] **Step 2: Commit** — `git commit -am "feat(market-seed): --real-only (60 real companies, no synthetic)"`

### Task C3: Provisioning runbook (executed by owner / with creds)

**Files:**
- Create: `Mark-analytics/DEPLOY-VERCEL.md`

Documents, with exact commands, the one-time provisioning (see “Provisioning runbook” section below). No code test; this is operator documentation.

- [ ] Commit — `git commit -am "docs(market): Vercel deploy + DB provisioning runbook"`

---

## Phase D — Portal wiring (minimal, additive)

### Task D1: CSP frame-src + connect-src for the Mark-analytics origin

**Files:**
- Modify: portal CSP source (`next.config.mjs` headers or `middleware.ts` — whichever currently sets CSP).

- [ ] **Step 1:** Find current CSP — `grep -rnE "Content-Security-Policy|frame-src|frame-ancestors" next.config.mjs middleware.ts app/ 2>/dev/null`.
- [ ] **Step 2:** Add the Mark-analytics production origin to `frame-src` (iframe embed) and `connect-src` (SPA runs in that iframe on its own origin, but the portal fetches `MARKET_API_URL` server-side, so `connect-src` may be unaffected — verify). Example directive fragment: `frame-src 'self' https://MARKET_DOMAIN;`.
- [ ] **Step 3:** If no CSP exists yet, do the minimal safe addition (frame-src only) rather than introducing a full strict policy.
- [ ] **Step 4: Commit** — `git commit -am "feat(portal): allow embedding Mark-analytics origin (CSP frame-src)"`

### Task D2: .env.example guidance

**Files:**
- Modify: `.env.example`

- [ ] **Step 1:** Update the two entries to point at the deployed Mark-analytics project (documented, not localhost):

```text
# Mark-analytics deployment (single Vercel project: SPA + read-API).
# Portal embeds the SPA and proxies /api/market/* to the read-API.
NEXT_PUBLIC_MARKET_APP_URL=https://MARKET_DOMAIN
MARKET_API_URL=https://MARKET_DOMAIN/api/v1
```

- [ ] **Step 2: Commit** — `git commit -am "docs(portal): point market env vars at the deployed Mark-analytics project"`

---

## Phase E — Verification

### Task E1: Slim-runtime import proof (critical — validates the 250MB/import strategy)

- [ ] **Step 1:** Build a throwaway venv with ONLY `Mark-analytics/requirements.txt` and prove the function app imports and every `READ_ROUTERS` entry loads (no missing heavy dep):

```bash
cd Mark-analytics
python3.12 -m venv /tmp/mkslim && /tmp/mkslim/bin/pip install -q -r requirements.txt
DATABASE_URL=postgresql+asyncpg://u:p@localhost:5432/mark SERVERLESS=true \
  /tmp/mkslim/bin/python -c "import sys; sys.path.insert(0,'backend'); \
  from api.index import app; \
  print('routes', len([r for r in app.routes]))"
```
  Expected: prints a route count > 15 and NO ImportError. If a router is dropped by `_safe_include`, it logs nothing but is simply absent — cross-check the printed routes include `/api/v1/geo`, `/api/v1/competitors`, `/api/v1/analytics`, `/api/v1/regions`.

- [ ] **Step 2:** Estimate installed size (`du -sh /tmp/mkslim/lib/python3.12/site-packages`) — must be well under Vercel's 250 MB unzipped function limit. Record the number.

### Task E2: Preview deploy + live checks (needs Vercel creds)

- [ ] Deploy a **preview** of the Mark-analytics project (`vercel --cwd Mark-analytics`), set env, then:
  - `curl https://<preview>/api/v1/... /health` → `{"status":"ok"}`
  - `curl "https://<preview>/api/v1/geo/companies?bbox=46,40,88,56&zoom=5"` → GeoJSON with 60 features (after seed).
  - Open the portal preview with `NEXT_PUBLIC_MARKET_APP_URL`/`MARKET_API_URL` pointing at the preview → `/market` map renders 60 points; `/market?tab=niche` calculator returns a niche result; the “недоступен” card is gone.

### Task E3: Promote to production

- [ ] After preview passes: set the two portal env vars in the portal's Vercel project (Production), promote the Mark-analytics deploy to production, redeploy the portal. Verify `https://PORTAL_DOMAIN/market`.

---

## Provisioning runbook (one-time; needs Vercel + Supabase creds + the Excel)

> These steps touch external systems (create a Vercel project, run prod migrations, seed). They are irreversible/outward-facing — run deliberately.

1. **Enable pgvector + create schema** (Supabase SQL editor or psql on `DATABASE_URL_DIRECT`):
   ```sql
   create extension if not exists vector;
   create schema if not exists market;
   ```
2. **Run migrations into `market`** (from a machine with the direct URL):
   ```bash
   cd Mark-analytics/backend
   export DB_SCHEMA=market
   export DATABASE_URL="postgresql+asyncpg://…@db.<proj>.supabase.co:5432/postgres"
   alembic upgrade head
   ```
3. **Seed 60 real companies** (Excel on owner's machine):
   ```bash
   export DATABASE_URL="…pooler…6543/postgres"; export DB_SCHEMA=market
   python scripts/seed_demo_companies.py --real-only
   ```
4. **Create the Mark-analytics Vercel project** (root dir `Mark-analytics/`), set env:
   `DATABASE_URL` (pooler), `DB_SCHEMA=market`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, `ALLOWED_ORIGINS=https://PORTAL_DOMAIN`, and frontend `VITE_*` (Task B3). Deploy.
5. **Point the portal** (portal Vercel project, Production env): `NEXT_PUBLIC_MARKET_APP_URL=https://MARKET_DOMAIN`, `MARKET_API_URL=https://MARKET_DOMAIN/api/v1`. Redeploy portal.
6. **Verify** per Task E2/E3.

---

## Verification results (2026-07-04, executed)

Backend serverless adaptation implemented and **verified locally**:
- **Slim import proof (E1):** built a venv from `requirements.txt` only; `api/index.py`
  imports cleanly and the read-API exposes **41 endpoints** incl. `/api/v1/geo/companies`
  (map), `/api/v1/competitors/{wizard,options,market-map}` (calculator), `/api/v1/analytics/*`,
  `/api/v1/regions/risk`, `/api/v1/news/recent`, `/api/v1/widgets/*`.
- **Size:** ~159 MB installed site-packages — well under Vercel's 250 MB function limit.
- **Finding — redis is a runtime dep of the read path** (caching/quota/deps). Added
  `redis>=5.1.0` to `requirements.txt`; provision Upstash Redis + `REDIS_URL` (runbook).
- **Finding — package eager-aggregation:** `app/api/v1/__init__.py` wired ALL routers at
  import (pulling croniter/boto3/scrapy/fastembed). Guarded behind `if not settings.SERVERLESS`.
  `api/index.py` sets `SERVERLESS=true` before import, so only the curated read routers load.
- **Unit tests (5) pass:** `tests/test_session_schema.py` (NullPool under serverless/pooler;
  search_path set when `DB_SCHEMA`; none by default) + `tests/test_read_api_imports.py`
  (read app builds with read routes; heavy routers excluded).
- **Measurement gotcha:** FastAPI 0.139 represents `include_router` as a lazy `_IncludedRouter`
  (no `.path`); verify routes via `app.openapi()['paths']`, not `app.routes[*].path`.

Still pending (provisioning — needs Vercel/Supabase creds + the seed Excel): create the
Mark-analytics Vercel project, run migrations into `market`, seed 60 real companies, set env
on both projects, live smoke-test (Tasks E2/E3 + runbook).

## Self-review checklist (author)

- Spec coverage: map (geo router), calculator (competitors router), insights (postMessage — unchanged), widgets (widgets router), news (news router) — all included in `READ_ROUTERS`. ✔
- Collision: isolated via `market` schema + search_path. ✔
- Function size: slim requirements + thin entry, verified in E1. ✔
- Owner's code untouched: only env + CSP on portal side. ✔
- Data honesty: 60 real only (`--real-only`), no synthetic. ✔
- Open risk to watch during execution: a `READ_ROUTERS` module importing a heavier dep than expected (E1 catches it → drop router or add light dep).
