# ADR-0003: Supabase Postgres + pgvector как основное хранилище

- Status: Accepted (2026-05-24, заменяет ранний вариант с Neon)
- Related: [ADR-0006](0006-supabase-auth.md)

## Контекст

Frontend на Vercel **уже использует Supabase** для auth и базового CRUD. У нас два варианта:

1. Развести: frontend на Supabase, backend на отдельной БД (например Neon) → постоянная синхронизация, дубли данных, два source-of-truth.
2. Объединить: всё на одной Supabase-инстанции, frontend пишет напрямую где уместно, backend подключается тем же connection string и делает тяжёлую логику.

Вариант (2) однозначно лучше для скорости разработки и консистентности.

## Решение

**Единая Supabase Postgres**, та же инстанция, что у Vercel-фронта.

### Расширения (включить через Supabase Dashboard → Database → Extensions)
- `vector` (pgvector) — semantic search
- `pg_trgm` + `unaccent` — fuzzy text / dedup
- `postgis` — гео (адреса)
- `pgcrypto`, `citext` — стандарт
- `pg_stat_statements` (есть из коробки) — APM

### Схема доступа

- **Frontend** ходит через `@supabase/supabase-js` с `anon` key и RLS-политиками. Делает: auth, прямые SELECT публичных таблиц (по 1 запросу), realtime подписки.
- **Backend** подключается через `asyncpg` с **service-role connection string** (Supabase Pooler в режиме transaction, порт 6543). Делает: writes, batches, AI extraction, агрегации, миграции.
- **RLS**: включён везде. Service-role обходит RLS — backend сам отвечает за авторизацию.

### Connection strings

```
# Direct (для миграций/CLI): порт 5432
postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres

# Pooled (для приложения, transaction mode): порт 6543
postgresql+asyncpg://postgres:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?ssl=require
```

В коде `app.config.settings.DATABASE_URL` — pooled. Alembic использует direct (через `DATABASE_URL_DIRECT`).

### Local development

В docker-compose поднимаем **обычный Postgres 16** с теми же расширениями, чтобы миграции и тесты работали офлайн. Опционально — `supabase start` (Supabase CLI) для полной локальной эмуляции с auth/storage.

```yaml
# infra/docker/docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mark
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data", "./init.sql:/docker-entrypoint-initdb.d/init.sql"]
```

`init.sql` включает все нужные extensions.

## Последствия

**Плюсы**:
- Один source-of-truth, никаких sync между Supabase и Neon.
- Frontend получает realtime подписки бесплатно (Supabase realtime built-in).
- Не нужно строить auth с нуля.
- RLS даёт second line of defense.
- Дёшево на старте (free tier 500 МБ → Pro $25/мес).

**Минусы**:
- Привязка к Supabase. Mitigation: код использует ANSI SQL + asyncpg, переход на любой Postgres — один env-флаг.
- Pooler transaction mode не поддерживает session-state (prepared statements, advisory locks). Mitigation: используем `statement_cache_size=0` в asyncpg для pooled connection; для long-running операций (миграции, реcrawl) — direct connection.
- При vector-объёмах > 5–10M строк pgvector может замедлиться. Mitigation: HNSW индекс, фильтры до vector-search; в Phase 3 — миграция векторов в Qdrant.

## Когда пересматривать

- Объём БД > 8 ГБ (приближение к Pro лимиту 8 ГБ) → upgrade или вынос cold-data в R2.
- p95 vector search > 200 ms → выделенный Qdrant.
- Read-write contention → read replicas (Supabase даёт на Pro+).

## Альтернативы (отвергнуты)

- **Neon + отдельный Supabase для frontend** — два source-of-truth, дублирование.
- **Своя БД на Railway Postgres + auth** — нужен свой auth-flow, нет realtime, не выигрыш.
- **PlanetScale** — нет pgvector, MySQL-стек не совместим.
