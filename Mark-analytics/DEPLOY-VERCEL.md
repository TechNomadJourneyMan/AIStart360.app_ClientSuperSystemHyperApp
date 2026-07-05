# Deploy Mark-analytics to Vercel (SPA + read-API)

One Vercel project, built from this directory, serves **both** the Vite SPA
(static) and the FastAPI **read-API** as a Python Function under `/api`. It runs
against the **shared Supabase Postgres**, isolated in the **`market` schema** so
it never collides with the portal's `public.companies`. No localhost, no
separate always-on service.

> Files that make this work: [`vercel.json`](./vercel.json),
> [`requirements.txt`](./requirements.txt), [`api/index.py`](./api/index.py),
> [`.vercelignore`](./.vercelignore),
> [`backend/app/api/v1/read_api.py`](./backend/app/api/v1/read_api.py).

## What's included vs deferred

- **Works:** KZ map (`/geo`), niche/TAM-SAM-SOM calculator (`/competitors`),
  market insights (portal → SPA via postMessage, no backend), widgets, news,
  regions, filters, search, and the stub read routers.
- **Deferred (need the full always-on backend + worker tier):** crawlers /
  auto data-refresh, live tenders & forecasts, Neo4j graph, R2 archive, AI
  digest/analyst chat, document uploads. Their endpoints return honest
  empty/stub data — the UI degrades gracefully.

---

## One-time provisioning

Prereqs: access to the portal's **Supabase** (direct + pooler connection
strings, JWT secret), a **Vercel** account/team, the Vercel CLI
(`npm i -g vercel@latest`), and the seed Excel
`…/New advanced Data/kazakhstan_market_data_registry.xlsx` (on the owner's
machine).

### 1. Database: schema + pgvector + migrations

```bash
# a) enable extension + schema (Supabase SQL editor or psql on the DIRECT url)
#    create extension if not exists vector;
#    create schema if not exists market;
#    (the migration step below also does this, but doing it explicitly is safe)

# b) run migrations INTO the market schema (from a machine with the DIRECT url)
cd backend
export DB_SCHEMA=market
export DATABASE_URL_DIRECT="postgresql://postgres:<pwd>@db.<proj>.supabase.co:5432/postgres"
# (DATABASE_URL is also read; DIRECT is preferred for DDL)
export DATABASE_URL="$DATABASE_URL_DIRECT"
alembic upgrade head
```

Verify: `\dt market.*` in psql shows `companies`, `addresses`, `persons`, … and
`market.alembic_version` exists.

### 2. Seed 60 real companies (honest, no synthetic)

```bash
cd backend
export DB_SCHEMA=market
export DATABASE_URL="postgresql+asyncpg://postgres:<pwd>@<proj>.pooler.supabase.com:6543/postgres"
# Ensure the xlsx path in scripts/seed_demo_companies.py (XLSX_PATH) points at
# your local file, then:
python scripts/seed_demo_companies.py --real-only
```

Expected: `Loaded 60 real companies from xlsx` → `Inserted 60 companies total`.

### 3. Create + configure the Vercel project

```bash
cd ..                      # into Mark-analytics/
vercel link                # create/link a NEW project (root dir = Mark-analytics)
```

Set env (Production + Preview) — Vercel dashboard or `vercel env add`:

**Function (Python) env:**
| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:<pwd>@<proj>.pooler.supabase.com:6543/postgres` |
| `DB_SCHEMA` | `market` |
| `SERVERLESS` | `true` |
| `SUPABASE_JWT_SECRET` | portal project's JWT secret |
| `SUPABASE_URL` | `https://<proj>.supabase.co` |
| `ALLOWED_ORIGINS` | `https://PORTAL_DOMAIN` (portal prod origin) |
| `REDIS_URL` | `rediss://…@<name>.upstash.io:6379` (Upstash free tier — used by caching/quota on the read path) |

> **Redis:** the read path imports `redis` (caching / quota / rate-limit helpers).
> Create a free Upstash Redis DB and set `REDIS_URL` so those work. It is NOT the
> Arq worker queue (that stays on the full backend) — just a cache for reads.

**Frontend (build) env** — see `frontend/.env.production.example`:
`VITE_API_BASE_URL=/api/v1`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_PORTAL_ORIGIN=https://PORTAL_DOMAIN`.

Also edit `vercel.json` → replace `PORTAL_DOMAIN` in the `frame-ancestors` CSP
with the real portal host, then:

```bash
vercel deploy               # preview
# smoke-test the preview (below), then:
vercel deploy --prod
```

### 4. Point the portal at it

In the **portal** Vercel project (Production env):

```
NEXT_PUBLIC_MARKET_APP_URL = https://MARKET_DOMAIN
MARKET_API_URL             = https://MARKET_DOMAIN/api/v1
```

Redeploy the portal (portal CSP `frame-src`/`connect-src` pick up
`NEXT_PUBLIC_MARKET_APP_URL` automatically — see `next.config.mjs`).

---

## Smoke tests

```bash
curl https://MARKET_DOMAIN/api/v1/../health          # {"status":"ok", ...}
curl "https://MARKET_DOMAIN/api/v1/geo/companies?bbox=46,40,88,56&zoom=5"
#   → GeoJSON FeatureCollection with ~60 features after seeding
```

Then open `https://PORTAL_DOMAIN/market`:
- «Карта» tab → map renders ~60 company points.
- «Анализ ниши» → the 5-step wizard returns a niche result + TAM/SAM/SOM.
- The «Продукт „Рынок" недоступен» card is gone.

## Notes / gotchas

- **Function size:** `requirements.txt` is deliberately slim (no scrapy/
  playwright/fastembed/neo4j/boto3). If you add a route that needs one of those,
  it belongs on the full backend, not here.
- **Pooler:** use the **transaction pooler** (`:6543`) for the function
  (`DATABASE_URL`) and the **direct** (`:5432`) for migrations
  (`DATABASE_URL_DIRECT`). The engine already sets `statement_cache_size=0` for
  the pooler and uses `NullPool` under `SERVERLESS`.
- **Schema:** everything is pinned to `search_path = market,public`. To wipe and
  re-seed, operate on `market.companies` only — the portal's `public.companies`
  is untouched.
