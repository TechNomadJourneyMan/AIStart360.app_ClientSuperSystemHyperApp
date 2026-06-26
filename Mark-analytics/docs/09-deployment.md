# 09 — Deployment

## Целевая топология (production MVP)

```
┌────────────────────────┐                ┌──────────────────────┐
│   Vercel               │ ──Supabase──►  │  Supabase Auth+DB    │
│   Next.js frontend     │   JS SDK       │  (project shared)    │
│   + @supabase/supabase-js│              └────────┬─────────────┘
└────────┬───────────────┘                         │
         │ REST + Supabase JWT                     │ asyncpg
         ▼                                         │ (service-role)
┌────────────────────────┐                         │
│  Railway / Fly.io      │ ────────────────────────┤
│  FastAPI service       │                         │
│  (always-on, 1-2 vCPU) │                         │
│  validates JWT via JWKS│                         │
└──────────┬─────────────┘                         │
           │                                       │
   ┌───────┼─────────────┬─────────────┐           │
   │       │             │             │           │
   ▼       ▼             ▼             ▼           ▼
┌──────┐┌──────────┐┌──────────┐┌─────────────┐ (тот же
│ R2   ││ Upstash  ││ Neo4j    ││  Sentry     │  Supabase
│ raw  ││ Redis    ││ AuraDB   ││             │  Postgres,
│ HTML ││ queue    ││ graph    ││             │  что и фронт)
└──────┘└────┬─────┘└──────────┘└─────────────┘
             │
       ┌─────┴────────┐
       │ Railway      │
       │ Worker svc   │ ── Arq, runtime agents
       │ (1-4 inst)   │
       └──────────────┘

         ┌────────────────────────────────────┐
         │  AI providers (over HTTPS)         │
         │  - OpenRouter                      │
         │  - Google AI Studio                │
         └────────────────────────────────────┘
```

## Платформы (рекомендация)

### Railway
- **Плюсы**: простой Dockerfile-deploy, есть Postgres/Redis addons, $5 free credit/мес, healthchecks из коробки.
- **Минусы**: ограничение по vCPU/RAM на низких планах.
- **Use**: основной выбор для MVP.

### Fly.io
- **Плюсы**: ближе к региону пользователя (FRA, AMS, WAW для CIS), машины «всегда warm».
- **Минусы**: чуть сложнее настройка volumes.
- **Use**: если нужно low-latency для UI (запад России / Казахстан).

### Render
- **Плюсы**: free tier для веб-сервисов, простые env-секреты.
- **Минусы**: spin-down на free, медленные cold start.
- **Use**: альтернатива Railway.

### Yandex Cloud / VK Cloud
- **Use**: только если нужно соответствие 152-ФЗ (РФ data residency) или low-latency до Москвы.

## Конфигурация Railway

`infra/railway/railway.toml`:

```toml
[build]
builder = "dockerfile"
dockerfilePath = "infra/docker/Dockerfile.api"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 2"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "always"
```

Для worker — отдельный сервис:

```toml
[build]
builder = "dockerfile"
dockerfilePath = "infra/docker/Dockerfile.worker"

[deploy]
startCommand = "arq app.workers.main.WorkerSettings"
restartPolicyType = "always"
```

## Environment variables (production)

```bash
# Core
APP_ENV=production
LOG_LEVEL=INFO
SECRET_KEY=...                          # 32+ bytes random (для внутренних подписей)

# Supabase (та же инстанция, что у фронта)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=eyJ...                # для server-to-supabase API вызовов
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # для admin-операций (lazy provisioning, webhooks)
SUPABASE_JWT_SECRET=...                 # для верификации JWT (или используем JWKS endpoint)
SUPABASE_WEBHOOK_SECRET=...             # для /internal/webhooks/auth

# Postgres (Supabase Pooler, transaction mode)
DATABASE_URL=postgresql+asyncpg://postgres:[PWD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?ssl=require
# Direct connection для миграций (Alembic)
DATABASE_URL_DIRECT=postgresql://postgres:[PWD]@db.[PROJECT].supabase.co:5432/postgres

# Redis (Upstash)
REDIS_URL=rediss://default:[PWD]@[host].upstash.io:6379

# Raw HTML storage (R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=mark-raw

# Neo4j
NEO4J_URI=neo4j+s://...
NEO4J_USER=neo4j
NEO4J_PASSWORD=...

# AI providers
OPENROUTER_API_KEY=sk-or-...
GOOGLE_AI_STUDIO_API_KEY=...
AI_FEATURE_SEMANTIC_CACHE=true
AI_DAILY_COST_CEILING_USD=100

# CORS
ALLOWED_ORIGINS=https://your-portal.vercel.app

# Observability
SENTRY_DSN=...
OTEL_EXPORTER_OTLP_ENDPOINT=...
```

## Локальная разработка

```bash
docker compose -f infra/docker/docker-compose.yml up -d
# Поднимает: postgres+pgvector, redis, minio (S3-compat для тестов R2)

cd backend
uv sync
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

Воркер:
```bash
arq app.workers.main.WorkerSettings
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **Lint** (`ruff check`, `ruff format --check`)
2. **Type check** (`mypy app/`)
3. **Tests** (`pytest backend/tests -q`)
4. **Docker build** (validate)
5. **Deploy** (Railway CLI on `main` push)

## Healthcheck

`GET /health` → 200 если:
- Postgres pingable
- Redis pingable
- OpenRouter / Google AI Studio reachable (cached 30s)

`GET /health/deep` (только internal) — детальный отчёт, используется при дебаге.

## Миграции

- **Alembic** для Postgres schema.
- Запуск миграций — отдельная команда (не в `startCommand`), чтобы не было race при multi-replica.
- В Railway это либо `releaseCommand` (custom), либо отдельный one-off job.

## Backup

| Что | Куда | Частота | TTL |
|-----|------|---------|-----|
| Postgres | Neon встроенный | Continuous | 7 дней (free), 30 (paid) |
| R2 | versioning enabled | per write | 30 дней |
| Neo4j | AuraDB managed backup | daily | 7 дней |
| Redis | не backup'им | — | — (можем восстановить из source) |

## Scaling план

| Stage | API instances | Worker instances | Postgres | Redis |
|-------|---------------|------------------|----------|-------|
| MVP | 1 (512 MB) | 1 (1 GB) | Neon Hobby ($19) | Upstash Free |
| 1k DAU | 2 (1 GB) | 3 (1 GB) | Neon Pro ($69) | Upstash 1k/s |
| 10k DAU | 4 (2 GB) | 10 (2 GB) | Neon scale-out | Upstash Pro |
| 100k DAU | переход на K8s | — | dedicated PG | Redis Cluster |

## Disaster recovery

- **RPO**: 5 минут (Neon continuous backup)
- **RTO**: 30 минут (Railway redeploy + restore)
- **DR runbook**: `docs/adr/runbooks/disaster-recovery.md` (Phase 2)

## Security baseline (cм. также security ADR)

- Все секреты — через Railway env, никогда в git.
- HTTPS only (Railway/Fly выдают сертификаты).
- CORS жёстко на `ALLOWED_ORIGINS`.
- Rate limit на API (slowapi / fastapi-limiter): 60 req/min unauth, 600 auth.
- Auth: JWT с rotation, refresh-token в HttpOnly cookie.
- DB connections: only от Railway IP / private network.
- `pgcrypto` для шифрования PII полей в Postgres.
- Аудит лог всех auth-событий в `audit_log` table.
