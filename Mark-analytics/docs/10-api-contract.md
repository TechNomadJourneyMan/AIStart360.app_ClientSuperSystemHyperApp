# 10 — API Contract (v1)

> Стабильный REST API для Next.js frontend на Vercel. Breaking changes → `/api/v2/`.

## Базовый формат ответа

```jsonc
{
  "data": { ... } | [ ... ],
  "meta": {
    "request_id": "uuid",
    "took_ms": 123,
    "page": { "cursor_next": "...", "cursor_prev": "...", "limit": 20 }
  },
  "errors": [
    { "code": "VALIDATION_ERROR", "message": "...", "field": "..." }
  ]
}
```

- `data` присутствует только при успехе (2xx).
- `errors` — массив, всегда; пустой при успехе.
- Pagination — cursor-based для всех list-эндпоинтов.

## Аутентификация (Supabase Auth)

Backend **не выдаёт собственные токены** — использует JWT от Supabase Auth. См. [ADR-0006](adr/0006-supabase-auth.md).

Frontend получает JWT от Supabase JS SDK, шлёт его в `Authorization: Bearer <supabase_jwt>`. Backend верифицирует через JWKS (`${SUPABASE_URL}/auth/v1/keys`).

| Метод | Путь | Описание |
|-------|------|----------|
| GET  | `/api/v1/auth/me` | текущий пользователь (заверенный + extension-поля из нашей `users`: plan, org_id, quotas) |
| POST | `/api/v1/auth/sync` | lazy-provision: если supabase юзер впервые приходит — создаст запись в `users` |
| POST | `/api/v1/internal/webhooks/auth` | Supabase webhook (signup, password reset) — internal, секрет в env |

Регистрация, логин, OAuth, password reset, magic links — всё через Supabase SDK на фронте. Backend в это не вовлечён.

## Companies

### `GET /api/v1/companies`

Query params:
- `q` — full-text + semantic search query
- `country` — `KZ`, `RU`, `UZ` (multi: `country=KZ,RU`)
- `industry` — ОКЭД/ОКВЭД (multi)
- `status` — `active`, `liquidated`, ...
- `registered_after`, `registered_before` (ISO date)
- `employee_min`, `employee_max`
- `revenue_usd_min`, `revenue_usd_max`
- `tags` (multi)
- `sort` — `name|registered_at|revenue|updated_at` (prefix `-` для desc)
- `cursor`, `limit` (default 20, max 100)

Response:
```jsonc
{
  "data": [
    {
      "id": "uuid",
      "bin": "123456789012",
      "name": "ТОО Альфа",
      "country": "KZ",
      "legal_form": "ТОО",
      "status": "active",
      "industry": { "code": "62.01", "label": "Разработка ПО" },
      "registered_at": "2018-05-12",
      "employee_count": 42,
      "revenue_usd": 1250000.00,
      "website": "https://alfa.kz",
      "address": { "city": "Алматы", "street": "..." },
      "tags": ["saas", "b2b"],
      "confidence": 0.92,
      "updated_at": "2026-05-22T..."
    }
  ],
  "meta": { ... }
}
```

### `GET /api/v1/companies/{id}`

Расширенный профиль:
- все поля из списка
- `field_provenance`: { field → [{ value, source_page_id, extracted_at, confidence }] }
- `persons`: связанные люди (директора, учредители) — top-20
- `tenders`: последние 20 связанных тендеров
- `news`: 20 последних упоминаний
- `summary_ai`: краткое описание (cached 24h, генерируется Summarization Agent)

### `GET /api/v1/companies/{id}/changes`

Таймлайн изменений (companies_changes):
```jsonc
{
  "data": [
    {
      "field": "employee_count",
      "old": 30,
      "new": 42,
      "detected_at": "2026-05-20T...",
      "source": { "url": "...", "label": "2GIS" }
    }
  ]
}
```

### `GET /api/v1/companies/{id}/graph`

Returns N-hop связи для визуализации (формат cytoscape.js).

Params: `depth` (1-3, default 1), `kinds` (multi: `role,address,phone,domain`).

```jsonc
{
  "data": {
    "nodes": [{"id":"...","label":"...","kind":"company"}, ...],
    "edges": [{"source":"...","target":"...","kind":"ROLE","props":{...}}]
  }
}
```

## Search

### `POST /api/v1/search`

Универсальный поиск (semantic + structural).

Body:
```jsonc
{
  "query": "софтверные компании Алматы с выручкой > 1M",
  "filters": { "country": ["KZ"] },
  "mode": "hybrid",            // "semantic" | "lexical" | "hybrid"
  "limit": 20
}
```

Response — массив матчей с `score` и `highlights`.

Под капотом:
1. LLM (`Task.EXTRACT_QUERY_FILTERS`) распарсит NL-фильтры (где можно)
2. Embedding запроса (`Task.EMBED_QUERY`)
3. pgvector + trigram + filters → top-N
4. Optional re-rank через cross-encoder (Phase 2)

## Tenders

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/v1/tenders` | список с фильтрами (amount, deadline, customer) |
| GET | `/api/v1/tenders/{id}` | детали |
| GET | `/api/v1/tenders/{id}/similar` | похожие (semantic) |

## Persons

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/v1/persons` | список |
| GET | `/api/v1/persons/{id}` | детали + role_history + связи |

## Alerts

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/v1/alerts` | мои правила |
| POST | `/api/v1/alerts` | создать правило |
| GET | `/api/v1/alerts/{id}` | правило |
| PATCH | `/api/v1/alerts/{id}` | обновить |
| DELETE | `/api/v1/alerts/{id}` | удалить |
| GET | `/api/v1/alerts/{id}/events` | сработавшие события |
| POST | `/api/v1/alerts/{id}/test` | прогнать против последних N событий, dry-run |

Schema правила:
```jsonc
{
  "name": "Новые SaaS в Алматы",
  "filter": {
    "entity_type": "company",
    "country": "KZ",
    "industry": ["62.01"],
    "city": "Алматы",
    "trigger": "created"      // created | field_changed | tag_added | mentioned_in_news
  },
  "channels": [
    { "type": "telegram", "target": "@username", "throttle": "10/hour" },
    { "type": "email",    "target": "u@e.com" }
  ]
}
```

## Trends

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/v1/trends/industry/{code}` | динамика по отрасли (новые компании, средняя выручка) |
| GET | `/api/v1/trends/region/{code}` | динамика по региону |
| GET | `/api/v1/trends/tenders` | волатильность тендеров |
| GET | `/api/v1/trends/keywords?q=...` | mention frequency по новостям |

Params: `period=1w|1m|3m|6m|1y`, `granularity=day|week|month`.

## Жалобы и feedback (для UX)

| POST | `/api/v1/feedback/wrong-data` | { entity_id, field, suggestion } | для будущего HITL |

## Ограничения

- Rate limit:
  - unauth: 30 req/min
  - free user: 300 req/min
  - paid: 3000 req/min
- Search semantic: 20 req/min (дорого считать embeddings)
- Body size: max 1 MB

## OpenAPI

FastAPI генерирует автоматически на `/docs` (Swagger) и `/redoc`. JSON-schema — `/openapi.json`.

Из неё в frontend репозитории генерируем TS-клиент:
```bash
npx openapi-typescript-codegen --input https://api.mark.io/openapi.json --output src/api/generated
```

## Версионирование

- `v1` — текущий, стабильный с момента запуска MVP.
- Любое breaking change (удаление поля, изменение типа, переименование) → новая версия `v2/`.
- Не-breaking (добавление поля, нового эндпоинта) — в `v1` без проблем.
- Deprecation: header `Deprecation: <date>` + поле `meta.deprecated_in: "v2"`.
