# Railway deployment

## One-time setup

1. Create a Railway project: <https://railway.app/new>.
2. Add **PostgreSQL** plugin → no — we use **Supabase Postgres**, not Railway PG. Skip.
3. Add **Redis** plugin (cheap; alternative is Upstash).
4. Create two services in the project from the same GitHub repo:
   - **mark-api** — config path: `infra/railway/railway.toml`
   - **mark-worker** — config path: `infra/railway/railway-worker.toml`
5. In each service → Variables → bulk-import from `backend/.env.example`. Fill all values.
6. Link the Redis plugin to both services → it auto-injects `REDIS_URL`.
7. The first deploy will fail on migrations — run them manually:
   ```
   railway run --service mark-api alembic upgrade head
   ```
8. Set the custom domain in `mark-api` (Settings → Domains) and add it to `ALLOWED_ORIGINS`.

## Secrets to set

Required:
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (Supabase pooler, transaction mode)
- `DATABASE_URL_DIRECT` (Supabase direct, port 5432, for migrations only)
- `OPENROUTER_API_KEY`
- `GOOGLE_AI_STUDIO_API_KEY`
- `R2_ENDPOINT_URL` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET`
- `ALLOWED_ORIGINS` (comma-separated list including the Vercel domain)
- `SECRET_KEY` (random 32+ bytes)

Optional but recommended:
- `SENTRY_DSN`
- `NEO4J_URI` + `NEO4J_USER` + `NEO4J_PASSWORD`
- `TELEGRAM_BOT_TOKEN` (for alert delivery)

## Auto-deploy from GitHub

Each push to `main` triggers a build. To disable, toggle in service → Settings → Auto-deploy.

For staging — make a `staging` branch and a second pair of services.

## CLI deploy (manual)

```
railway link
railway up --service mark-api
```

`RAILWAY_TOKEN` for CI: dashboard → Account → Tokens.
