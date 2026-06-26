# 01 — Architecture

## Bounded Contexts (DDD)

Восемь автономных контекстов. Каждый — отдельный package в `backend/app/`, со своими моделями и API.

| Context | Owns | Внешний контракт |
|---------|------|------------------|
| **Discovery** | seeds, domains, candidate URLs | публикует `CompanyDiscovered` |
| **Crawl** | crawl-jobs, raw HTML, snapshots | публикует `PageFetched` |
| **Extraction** | parsing rules, LLM-extraction, OCR | публикует `EntityExtracted` |
| **Enrichment** | embeddings, NER, classification, dedup | публикует `EntityEnriched` |
| **Graph** | связи компания↔человек↔тендер↔адрес | API: graph-traversal |
| **Search** | full-text + semantic + filters | API: `/search` |
| **Alerts** | правила, evaluation, доставка | публикует `AlertFired` |
| **Trends** | агрегации, time-series, отчёты | API: `/trends/*` |

Контексты общаются **через шину событий** (Redis Streams в MVP, NATS позже). Никаких прямых вызовов между сервисами.

## Слои

```
┌─────────────────────────────────────────────────────────────┐
│                 Next.js Frontend (Vercel)                   │
│   ┌──────────────────────────────────┐                      │
│   │  @supabase/supabase-js SDK       │ ── auth, простые     │
│   │  (auth, lightweight CRUD)        │    SELECT через RLS  │
│   └──────────────────────────────────┘                      │
└──────────┬───────────────────────────┬──────────────────────┘
           │ Supabase JWT              │ REST + same JWT
           │ (auth)                    │ (тяжёлые операции)
           │                           ▼
           │              ┌────────────────────────────────────┐
           │              │     FastAPI App (Railway / Fly)    │
           │              │  /api/v1/ companies | search |     │
           │              │           alerts | trends          │
           │              │  JWT валидируется через Supabase   │
           │              │  JWKS (no shared secret leak)      │
           │              └────────────┬───────────────────────┘
           │                           │
           ▼                           ▼ asyncpg (service-role)
┌───────────────────────────────────────────────────────────────┐
│              Supabase Postgres (single source of truth)       │
│   + pgvector + postgis + pg_trgm + RLS-политики               │
└───────┬───────────────────────────────────┬───────────────────┘
        │ events                            │ raw HTML
        ▼                                   ▼
┌─────────────────┐                ┌──────────────────┐
│  Upstash Redis  │                │  Cloudflare R2   │
│  Streams + Arq  │                │  (crawl dumps)   │
│  + cache        │                └──────────────────┘
└────────┬────────┘
         │
         ▼
┌────────────────────┐
│  Arq Workers       │ ← запускают runtime agents
│  (crawl, extract,  │
│   enrich, alert)   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│   AI Gateway       │◄── единая точка входа в LLM
│   (Model Router)   │
└─────────┬──────────┘
          │
   ┌──────┴───────────────────────┐
   ▼                              ▼
┌───────────────┐         ┌───────────────────┐
│  OpenRouter   │         │ Google AI Studio  │
│  (DeepSeek,   │         │ (Gemini 2.5 Pro,  │
│   Qwen, Llama,│         │  Flash, Flash-8B) │
│   Claude...)  │         └───────────────────┘
└───────────────┘
       │                     │
       │           ┌─────────▼──────────┐
       │           │  Arq Workers       │  ← запускают runtime agents
       │           │  (crawl, extract,  │
       │           │   enrich, alert)   │
       │           └─────────┬──────────┘
       │                     │
       │                     ▼
       │           ┌────────────────────┐
       └──────────►│   AI Gateway       │◄── единая точка входа в LLM
                   │   (Model Router)   │
                   └─────────┬──────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
      ┌───────────────┐              ┌───────────────────┐
      │  OpenRouter   │              │ Google AI Studio  │
      │  (DeepSeek,   │              │ (Gemini 2.5 Pro,  │
      │   Qwen,       │              │  Gemini Flash,    │
      │   Llama,      │              │  Gemini Flash-8B) │
      │   Claude...)  │              └───────────────────┘
      └───────────────┘
```

## Технологический стек

### Backend
- **Python 3.12**, **FastAPI**, **Pydantic v2**
- **SQLAlchemy 2.0** + **Alembic**
- **Arq** (Redis-based job queue, проще Celery, async-нативный)
- **httpx** для HTTP, **tenacity** для ретраев
- **structlog** + **OpenTelemetry** для логирования/трейсинга

### Хранилища
- **Supabase Postgres** (та же инстанция, что у Vercel-фронта) + расширения: `pgvector`, `pg_trgm`, `unaccent`, `pgcrypto`, `postgis`, `citext`. Free tier 500 МБ → Pro $25/мес.
- **Supabase Auth** — единый поставщик identity. Backend валидирует JWT через JWKS (`{SUPABASE_URL}/auth/v1/keys`).
- **Supabase Storage** — user-facing файлы (аватары, экспорты, отчёты).
- **Cloudflare R2** — raw HTML / screenshots от crawler'ов (S3-совместимый, без egress fee).
- **Redis 7** (Upstash) — очереди (Arq) + cache + rate-limit + streams + semantic cache.
- **Neo4j AuraDB Free** — граф связей (200k nodes / 400k relationships free).
- **Local dev**: Postgres 16 + pgvector + MinIO в Docker (`infra/docker/docker-compose.yml`) — миграции и схема идентичны Supabase.

### Crawling
- **Scrapy** — backbone (плановость, middlewares, throttling).
- **Playwright** — JS-heavy сайты (2GIS, Kolesa).
- **crawlee-python** — антибот, прокси-ротация, fingerprint.
- **Bright Data / IPRoyal** прокси (residential, KZ/RU geo).

### AI / ML
- **OpenRouter** (chat, structured output, function-calling).
- **Google AI Studio** (Gemini 2.5 Pro / Flash — большой free-tier, длинный контекст).
- **fastembed** для локальных embeddings (BGE-M3) — без GPU, на CPU.
- **DSPy** для prompt-engineering (опционально, Phase 2).

### Frontend (уже есть)
- **Next.js 14+ (App Router)** на Vercel.
- Бэкэнд отдаёт `OpenAPI 3.1` → автогенерация TS-клиента через `openapi-typescript-codegen`.

### Observability
- **Logfire** или **Sentry** — APM + error tracking.
- **OpenTelemetry** → Honeycomb/Grafana Cloud Tempo.
- Свой `ai_call_log` в Postgres — для аналитики стоимости.

## Inbound / outbound контракты

### Inbound (что фронт шлёт)

- `GET /api/v1/companies?q=&filters=&page=`
- `GET /api/v1/companies/{id}`
- `GET /api/v1/companies/{id}/changes` — таймлайн изменений
- `POST /api/v1/search` — семантический + структурный
- `GET /api/v1/trends/{topic}?period=`
- `POST /api/v1/alerts` — создать правило мониторинга
- `GET /api/v1/alerts/{id}/events`
- `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`

Все эндпоинты возвращают JSON со схемой `{ data, meta, errors }`. Pagination — cursor-based. См. [10-api-contract.md](10-api-contract.md).

### Outbound (что бэк дёргает)

- OpenRouter `/chat/completions`, `/embeddings`
- Google AI Studio `/v1beta/models/*:generateContent`
- Gov-registry APIs (там, где есть)
- Прокси-провайдеры
- Webhooks для алёртов (Slack, Telegram, Email)

## Решения, которые сделаны заранее

См. ADR-ы в [docs/adr/](adr/). Кратко:
- ADR-0001: AI-инференс только через cloud API (без локального GPU)
- ADR-0002: OpenRouter + Google AI Studio как два провайдера
- ADR-0003: Supabase Postgres + pgvector как основное хранилище (Qdrant — опция позже)
- ADR-0004: Arq вместо Celery
- ADR-0005: Event-driven через Redis Streams в MVP
- ADR-0006: Supabase Auth — единый identity provider для фронта и бэка

## Что меняется по фазам

| Фаза | Что добавляем |
|------|---------------|
| MVP (мес. 1–3) | Discovery + Crawl + базовая Extraction, 3 источника, REST API, AI Gateway |
| Phase 2 (мес. 4–6) | Enrichment, Graph, Alerts, semantic search, 10+ источников |
| Phase 3 (мес. 7–9) | Trends, ML-классификаторы, OSINT-социалки, биллинг |
| Phase 4 (мес. 10–12) | Multi-tenant, white-label, ML re-ranking, mobile API |

Подробный план — [11-roadmap.md](11-roadmap.md).
