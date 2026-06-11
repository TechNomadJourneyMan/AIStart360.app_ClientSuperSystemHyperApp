# Market Intelligence integration

The Market Intelligence portal section reads live data from an external FastAPI
service, **Mark-analytics**, instead of fabricating values. This document
describes the architecture, environment variables, the proxy allowlist, and how
to run the backend locally.

## Architecture

```text
Browser (components/market/*)
        │  fetch /api/market/<path>
        ▼
Next.js proxy  app/api/market/[...path]/route.ts
   • requires a Supabase session (auth.getUser → 401 otherwise)
   • forwards the user's Supabase access token as  Authorization: Bearer <jwt>
   • allowlists forwardable paths; everything else → 404
   • cache: 'no-store', upstream timeout 8s
        │  → MARKET_API_URL  (e.g. http://localhost:8000/api/v1)
        ▼
Mark-analytics  (FastAPI, REST prefix /api/v1)
   • validates the SAME Supabase JWT (same Supabase project as the portal)
   • response envelope:  { data, meta, errors }
        │
        ▼
Shared Supabase Postgres  (companies, news, tenders, analytics, …)
```

Client-side, all access goes through the typed helpers in `lib/market-api.ts`
(`getNews`, `getCompetitors`, `getMarketOverview`, `getIntelligenceAlerts`).
These map the upstream `{ data, meta, errors }` envelope **defensively** into the
portal interfaces in `components/market/mock-data.ts` (`Competitor`, `NewsItem`,
`IntelligenceAlert`, `MarketData`). Unknown/missing upstream fields become
nulls / `0` / `'—'` — never invented values. Non-2xx responses and any populated
`errors` array are treated as failures, and the components keep their existing
Russian empty states.

## Data-integrity behaviour

- Backend **unset** (`MARKET_API_URL` missing) → proxy returns `503
  { ok:false, error:'market_api_not_configured' }`; the UI shows the empty state
  plus a subtle line «Сервис рыночных данных не подключён».
- Backend **unreachable / timeout** → proxy returns `503
  { ok:false, error:'market_api_unavailable' }`; the UI shows «Сервис рыночных
  данных временно недоступен».
- The **YoY** chip on Market Overview renders only when the upstream actually
  provides the figure — it never shows `0%` as if it were real.
- Intelligence "signals" are derived from real `tenders/recent` records and
  labelled honestly («Тендер» with sum + customer). No fabricated price-drop or
  legal-risk events.
- Competitor revenue is formatted with its source currency (`revenue_usd` → `$`,
  otherwise `₸` via `formatKZT`) rather than mislabelling USD as KZT.

## Environment variables

| Var              | Purpose                                                            |
| ---------------- | ----------------------------------------------------------------- |
| `MARKET_API_URL` | Base URL of Mark-analytics incl. `/api/v1` prefix. Server-only.   |

The proxy also relies on the existing Supabase vars
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) to read the user's
session and access token.

## Proxy allowlist

Only these upstream path prefixes are forwardable (`app/api/market/[...path]/route.ts`);
anything else returns 404:

- `news/recent`
- `companies`
- `competitors/options`
- `competitors/wizard`
- `tenders/recent`
- `analytics/kz`
- `trends`
- `search`

Both `GET` and `POST` are supported (the JSON body and query string are
forwarded as-is).

## Running the backend locally

```bash
# 1. (Optional) infra — Postgres / Redis / MinIO, only if not using Supabase directly
docker compose -f infra/docker/docker-compose.yml up -d

# 2. The FastAPI service
cd Mark-analytics/backend
uvicorn app.main:app --port 8000
```

Then set in the portal's `.env.local`:

```bash
MARKET_API_URL=http://localhost:8000/api/v1
```

Because Mark-analytics validates the same Supabase JWT, no extra credentials are
needed — the portal forwards the signed-in user's token automatically.
