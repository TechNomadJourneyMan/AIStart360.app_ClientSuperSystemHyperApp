# Mark-analytics («Рынок») — integration & availability

The Mark-analytics market-intelligence service is **vendored into this repo** at
`Mark-analytics/` (source-only snapshot; `node_modules`, `.venv`, `.env*` are
gitignored — install deps locally). The portal talks to it over HTTP:

```
portal /market page + components/market/*  ──fetch /api/market/<path>──▶  app/api/market/[...path] (proxy, requires Supabase session)
                                                                              │  → MARKET_API_URL  (default http://localhost:8000/api/v1)
                                                                              ▼
                                                                      Mark-analytics FastAPI (:8000)
portal iframe (NEXT_PUBLIC_MARKET_APP_URL, default http://localhost:5173) ──▶ Mark-analytics Vite SPA (:5173)
```

Portal `.env.local` must set (already added locally):
```
MARKET_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_MARKET_APP_URL=http://localhost:5173
```

## 1. Run locally (one-off)

```bash
cd Mark-analytics/backend  && uv run uvicorn app.main:app --port 8000   # API  :8000
cd Mark-analytics/frontend && npm install && npm run dev                 # SPA  :5173
```

## 2. Always-on locally (macOS launchd)

Two LaunchAgents auto-start both services at login and restart them on crash
(`RunAtLoad` + `KeepAlive`). They point at the working checkout
`/Users/ansarisenoff/AI-Portal/Mark-analytics` (where deps are installed):

- `~/Library/LaunchAgents/com.aistart360.market-backend.plist`  → uvicorn :8000
- `~/Library/LaunchAgents/com.aistart360.market-frontend.plist` → vite :5173

Manage:
```bash
launchctl load  -w ~/Library/LaunchAgents/com.aistart360.market-backend.plist
launchctl load  -w ~/Library/LaunchAgents/com.aistart360.market-frontend.plist
launchctl list | grep aistart360            # status (col 1 = PID when running)
launchctl unload  ~/Library/LaunchAgents/com.aistart360.market-frontend.plist   # stop + disable
tail -f /tmp/aistart360-market-backend.err.log                                   # logs
```
Note: launchd keeps it up **while the Mac is on/logged in**. For true 24/7
availability use cloud deploy (§4).

## 3. Always-on for AI clients (MCP)

`Mark-analytics/tools/mark-analytics-mcp` exposes 5 read-only tools
(`search_companies`, `get_company`, `get_recent_tenders`, `industry_overview`,
`region_overview`) over stdio MCP. It is registered in the repo `.mcp.json`:

```json
"mark-analytics": {
  "command": "uv",
  "args": ["run","--directory","Mark-analytics/tools/mark-analytics-mcp","mark-analytics-mcp","--transport","stdio"],
  "env": { "MK_BASE_URL": "http://localhost:8000" }
}
```
Claude Code will prompt to approve the project MCP server. Set `MK_TOKEN` in the
`env` block for tier-gated endpoints. Point `MK_BASE_URL` at the deployed API
(§4) once it's hosted, for MCP access independent of the local service.

## 4. Cloud deploy (true 24/7 — requires your accounts/secrets)

This is the only way the Рынок is available without your Mac running. **Needs
your action** (accounts + secrets):

1. **Backend (FastAPI)** → a Python host (Railway / Render / Fly.io; Vercel
   Python is possible but the crawlers/jobs suit a long-running host better).
   Set its env (`DATABASE_URL`, `DATABASE_URL_DIRECT`, `ALLOWED_ORIGINS`, plus
   any data-source keys — see `Mark-analytics/backend/.env.example`). Note the
   public API URL, e.g. `https://mk-api.<you>.app`.
2. **Frontend (Vite SPA)** → Vercel / Netlify static build (`npm run build`).
   Note its URL, e.g. `https://mk-app.<you>.app`.
3. **Point the portal at them** — set in the portal's Vercel project env:
   ```
   MARKET_API_URL=https://mk-api.<you>.app/api/v1
   NEXT_PUBLIC_MARKET_APP_URL=https://mk-app.<you>.app
   ```
   and add the SPA origin to `next.config.mjs` CSP (`frame-src`/`connect-src`).
4. Redeploy the portal. The Рынок section now works for all users, always.
