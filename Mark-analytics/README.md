# AIStart360 — Market Intelligence backend

> Backend, питающий **Market Intelligence mega-section** портала [AIStart360.app](https://aistart360.app) (Vercel · Next.js · Supabase). AI-first платформа мониторинга бизнесов и рынка Казахстана и СНГ.
> FastAPI + AI Gateway над OpenRouter / Google AI Studio. Полная продуктовая спецификация — в [docs/aistart360/](docs/aistart360/).

## TL;DR

- **Назначение**: discovery + enrichment + monitoring компаний CIS-региона (Палантир-lite / Crunchbase / Apollo / ZoomInfo / PitchBook, но self-hosted и дешёвый).
- **AI стратегия**:
  - **Tier 1 (development)**: Claude Opus 4.7 — только для архитектуры, кода, debugging, agent-orchestration design.
  - **Tier 2 (production runtime)**: Gemini 2.5 Pro / Flash через Google AI Studio + DeepSeek V3.1 / Qwen3 / Llama 3.3 через OpenRouter.
  - **Tier 3 (опционально)**: локальные embedding-модели (BGE-M3) если появится свой GPU.
- **Multi-agent**: 8 dev-агентов (Architect, Backend, Crawler, AI, OSINT, Frontend, DevOps, Security) на этапе разработки + 7 runtime-агентов в production (Discovery, Crawl, Extraction, Classification, Trend, Alert, Summarization).

## Структура репозитория

```
Mark-analytics/
├── docs/                  # Архитектурные документы
│   ├── 00-overview.md           # Общая картина и принципы
│   ├── 01-architecture.md       # Слои, контексты, диаграммы
│   ├── 02-ai-gateway.md         # AI Gateway + Model Router
│   ├── 03-model-catalog.md      # Каталог моделей с ценами/латентностью
│   ├── 04-agents.md             # Multi-agent оркестрация
│   ├── 05-data-model.md         # PostgreSQL + pgvector + Neo4j
│   ├── 06-osint-pipeline.md     # OSINT-источники и enrichment
│   ├── 07-crawling.md           # Scrapy/Crawlee/Playwright стек
│   ├── 08-cost-optimization.md  # Caching, batching, semantic dedup
│   ├── 09-deployment.md         # Railway/Fly.io/K8s
│   ├── 10-api-contract.md       # REST API для Next.js фронта
│   ├── 11-roadmap.md            # 6-месячный план
│   ├── 12-multi-agent-dev.md    # Как использовать Claude-агентов в разработке
│   └── adr/                     # Architecture Decision Records
├── backend/                # FastAPI приложение
│   ├── app/
│   │   ├── api/v1/              # REST endpoints
│   │   ├── ai/                  # AI Gateway, router, providers, prompts
│   │   ├── agents/              # Runtime AI-агенты
│   │   ├── crawlers/            # Scrapy/Playwright сборщики
│   │   ├── osint/               # OSINT-модули
│   │   ├── models/              # SQLAlchemy модели
│   │   ├── schemas/             # Pydantic схемы (API контракт)
│   │   ├── db/                  # Сессии, миграции (Alembic)
│   │   ├── workers/             # Arq/Celery задачи
│   │   └── core/                # config, logging, security
│   ├── tests/
│   └── pyproject.toml
├── infra/
│   ├── docker/                  # Dockerfile для backend и worker
│   ├── railway/                 # Railway конфиги
│   └── k8s/                     # Манифесты на потом
├── scripts/                # Утилиты (seed, бенчмарки, dev-tooling)
├── tools/
│   └── mark-analytics-mcp/ # Standalone MCP server (Claude Desktop / Cursor) — см. `tools/mark-analytics-mcp/README.md`
└── .claude/agents/         # Конфиги dev-агентов (Architect, Backend, ...)
```

## Quick start (локально)

```bash
# 1. Установи зависимости
cd backend
uv sync                 # или: pip install -e .

# 2. Скопируй env-шаблон
cp .env.example .env
# заполни:
#   OPENROUTER_API_KEY
#   GOOGLE_AI_STUDIO_API_KEY
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (с дашборда Supabase)
#   SUPABASE_JWT_SECRET (для валидации пользовательских токенов)
# В DATABASE_URL для local dev — оставь дефолтную ссылку на локальный docker postgres.
# Для прод-смотрящей разработки — впиши Supabase Pooler connection string.

# 3. Подними локальные Postgres+Redis+MinIO (development storage)
docker compose -f ../infra/docker/docker-compose.yml up -d

# 4. Прогон миграций
alembic upgrade head

# 5. Запусти API
uvicorn app.main:app --reload --port 8000

# 6. Запусти worker (в другом терминале)
arq app.workers.arq_worker.WorkerSettings
```

API доступно на `http://localhost:8000`, документация `/docs`, `/redoc`.

## Production стек

| Слой | Сервис | Free tier | Зачем |
|------|--------|-----------|-------|
| Frontend | **Vercel** (уже есть) | да | Next.js, SSR/ISR |
| Auth | **Supabase Auth** (уже используется фронтом) | да | JWT, OAuth, magic links — backend валидирует токены через JWKS |
| Postgres | **Supabase Postgres** (та же инстанция, что у фронта) | да (500 МБ) | OLTP + pgvector + postgis + pg_trgm |
| Vector | Supabase Postgres + `pgvector` | — | Semantic search в той же БД |
| User files | **Supabase Storage** | да (1 ГБ) | Аватары, экспорты CSV/PDF, документы |
| Raw HTML | **Cloudflare R2** | да (10 ГБ) | High-volume crawl-данные (без egress fee) |
| API | **Railway** / Fly.io / Render | ~$5/мес | FastAPI always-on |
| Workers | Railway worker / Fly machines | ~$5/мес | Crawling, enrichment |
| Redis | **Upstash** | да (10k команд/день) | Queue (Arq) + cache + rate-limit + streams |
| Graph DB | **Neo4j AuraDB Free** | да (200k nodes) | Связи компании↔люди |
| Tracing | **Sentry** / Logfire | да | Errors + APM |
| AI inference | **OpenRouter + Google AI Studio** | щедрый | См. [03-model-catalog.md](docs/03-model-catalog.md) |

Frontend и backend смотрят на **одну Supabase-инстанцию** — frontend пишет напрямую через Supabase JS SDK где удобно (auth, простые CRUD), а backend FastAPI делает тяжёлую логику (crawling, AI, агрегации) через прямой Postgres connection с service-role ключом и валидирует пользовательские JWT через Supabase JWKS.

Базовая стоимость production без AI: **$10–25/мес** (Railway + R2 + Neo4j Free; Supabase в free tier до 500 МБ БД).
AI-стоимость на 1M запросов с правильным роутингом: **$5–40** (см. [08-cost-optimization.md](docs/08-cost-optimization.md)).

## Дальше читать

- Архитектура и принципы → [docs/01-architecture.md](docs/01-architecture.md)
- AI Gateway и роутинг моделей → [docs/02-ai-gateway.md](docs/02-ai-gateway.md)
- 6-месячный roadmap → [docs/11-roadmap.md](docs/11-roadmap.md)
- Как запускать Claude dev-агентов → [docs/12-multi-agent-dev.md](docs/12-multi-agent-dev.md)
