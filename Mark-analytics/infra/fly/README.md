# Fly.io deployment (alternative to Railway)

## Why Fly

- Edge regions close to CIS users (FRA, AMS, WAW).
- Always-warm machines, no spin-down.
- Simpler scaling than K8s.

## Setup

```
fly launch --no-deploy --copy-config --name mark-api --config infra/fly/fly.api.toml
fly secrets set --app mark-api \
    SUPABASE_URL=https://... \
    SUPABASE_JWT_SECRET=... \
    DATABASE_URL=postgresql+asyncpg://... \
    DATABASE_URL_DIRECT=postgresql://... \
    OPENROUTER_API_KEY=... \
    GOOGLE_AI_STUDIO_API_KEY=... \
    R2_ENDPOINT_URL=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
    SECRET_KEY=... \
    ALLOWED_ORIGINS=https://your.vercel.app

fly deploy --app mark-api --config infra/fly/fly.api.toml

# worker
fly launch --no-deploy --copy-config --name mark-worker --config infra/fly/fly.worker.toml
fly secrets set --app mark-worker ...  # same set as api
fly deploy --app mark-worker --config infra/fly/fly.worker.toml
```

## Migrations

```
fly ssh console --app mark-api -C "alembic upgrade head"
```

Run after every deploy that bumps schema.
