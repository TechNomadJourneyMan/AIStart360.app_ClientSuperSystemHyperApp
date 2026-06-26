# 05 — Data Model

## Хранилища и зачем каждое

| Store | Что хранит | Почему именно тут |
|-------|------------|-------------------|
| **Supabase Postgres** | core OLTP: companies, persons, tenders, sources, jobs, alerts, ai_call_log, users-extension | одна инстанция с фронтом (Vercel), без sync, дёшево на старте |
| **pgvector** (ext в Supabase) | embeddings (company_profile, news, query) | держим вместе с OLTP, до 5–10М векторов справится без отдельной системы |
| **Supabase Storage** | user-facing файлы: экспорты CSV/PDF, аватары, отчёты | одна экосистема с auth, signed URLs из коробки |
| **Cloudflare R2** | raw HTML, PDF, screenshots от crawler'ов (high-volume) | дёшево, нет egress, append-only — Supabase Storage дороже на масштабе |
| **Neo4j AuraDB** | граф связей: company↔person↔tender↔address↔phone↔domain | traversal-запросы за 1–2 мс, GraphRAG |
| **Upstash Redis** | очереди (Arq), cache (key+semantic), rate-limit, working memory, streams | low-latency |
| **Local dev** | docker-compose: postgres+pgvector+postgis, redis, minio (S3-compat) | офлайн-разработка, миграции идентичны проду |

## Postgres схема (ключевые таблицы)

> Полные миграции в `backend/app/db/migrations/`. Здесь — суть.

### `companies`

```sql
CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bin             VARCHAR(12) UNIQUE,                   -- KZ БИН/ИИН
    inn             VARCHAR(12),                          -- RU/UZ ИНН
    ogrn            VARCHAR(15),                          -- RU ОГРН
    country         CHAR(2) NOT NULL,                     -- KZ, RU, UZ, ...
    name            TEXT NOT NULL,
    name_normalized TEXT NOT NULL,                        -- для дедупа: lower + unaccent + spaces collapsed
    legal_form      VARCHAR(32),                          -- ТОО, ИП, ОсОО, ООО
    status          VARCHAR(32),                          -- active, liquidated, reorganizing
    registered_at   DATE,
    industry_code   VARCHAR(16),                          -- ОКЭД/ОКВЭД
    industry_label  TEXT,
    employee_count  INT,
    revenue_usd     NUMERIC(18,2),
    website         TEXT,
    email           TEXT,
    phone           TEXT,
    address_id      UUID REFERENCES addresses(id),
    geo             GEOGRAPHY(POINT, 4326),
    description     TEXT,
    tags            TEXT[],
    confidence      NUMERIC(3,2),                         -- aggregate quality score
    source_ids      UUID[],                               -- из каких source_records собрано
    embedding       VECTOR(1024),                         -- bge-m3
    raw             JSONB,                                -- всё остальное
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ
);

CREATE INDEX companies_country_idx        ON companies(country);
CREATE INDEX companies_industry_idx       ON companies(industry_code);
CREATE INDEX companies_name_trgm_idx      ON companies USING gin (name_normalized gin_trgm_ops);
CREATE INDEX companies_geo_idx            ON companies USING gist (geo);
CREATE INDEX companies_embedding_idx      ON companies USING hnsw (embedding vector_cosine_ops);
CREATE INDEX companies_tags_idx           ON companies USING gin (tags);
CREATE INDEX companies_raw_idx            ON companies USING gin (raw jsonb_path_ops);
```

### `persons`

```sql
CREATE TABLE persons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iin             VARCHAR(12),                          -- KZ ИИН (хэш если PII)
    full_name       TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    country         CHAR(2),
    role_history    JSONB,                                -- [{company_id, role, from, to}]
    contacts        JSONB,                                -- {phones:[], emails:[], social:[]}
    sanctions       BOOLEAN DEFAULT FALSE,
    embedding       VECTOR(1024),
    raw             JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### `tenders`

```sql
CREATE TABLE tenders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     TEXT NOT NULL,
    source          VARCHAR(64) NOT NULL,                 -- 'goszakup.kz', 'zakupki.gov.ru'
    customer_id     UUID REFERENCES companies(id),
    title           TEXT NOT NULL,
    description     TEXT,
    amount_usd      NUMERIC(18,2),
    currency        CHAR(3),
    status          VARCHAR(32),
    published_at    TIMESTAMPTZ,
    deadline_at     TIMESTAMPTZ,
    awarded_to      UUID REFERENCES companies(id),
    embedding       VECTOR(1024),
    raw             JSONB,
    UNIQUE (source, external_id)
);
```

### `pages` (crawl artifacts metadata)

```sql
CREATE TABLE pages (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url                TEXT NOT NULL,
    url_hash           CHAR(64) NOT NULL,                  -- sha256(url) для unique
    source             VARCHAR(64) NOT NULL,
    http_status        INT,
    content_type       TEXT,
    fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    html_r2_key        TEXT,                               -- 'raw/2026/05/24/<hash>.html.gz'
    screenshot_r2_key  TEXT,
    extraction_status  VARCHAR(16) DEFAULT 'pending',
    extracted_entities UUID[],                             -- ссылки на companies/persons/tenders
    UNIQUE (url_hash, fetched_at)
);
CREATE INDEX pages_source_fetched_idx ON pages(source, fetched_at DESC);
```

### `addresses`

```sql
CREATE TABLE addresses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_text        TEXT NOT NULL,
    normalized      TEXT,
    country         CHAR(2),
    region          TEXT,
    city            TEXT,
    street          TEXT,
    house           TEXT,
    postal_code     TEXT,
    geo             GEOGRAPHY(POINT, 4326),
    UNIQUE (country, normalized)
);
```

### `domain_events` (outbox)

```sql
CREATE TABLE domain_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(64) NOT NULL,
    aggregate_id    UUID NOT NULL,
    payload         JSONB NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ
);
CREATE INDEX events_unpublished_idx ON domain_events(occurred_at) WHERE published_at IS NULL;
```

### `ai_call_log`

(см. [02-ai-gateway.md](02-ai-gateway.md))

### `alerts` + `alert_rules`

```sql
CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    filter          JSONB NOT NULL,                        -- e.g., {country:'KZ', industry:'62.01', new_only:true}
    channels        JSONB NOT NULL,                        -- [{type:'telegram', target:'@u'}, {type:'email', ...}]
    enabled         BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alert_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id         UUID REFERENCES alert_rules(id),
    aggregate_id    UUID NOT NULL,
    payload         JSONB NOT NULL,
    fired_at        TIMESTAMPTZ DEFAULT NOW(),
    delivered_at    TIMESTAMPTZ
);
```

### `users` (extension над Supabase Auth)

Auth полностью на Supabase (см. [ADR-0006](adr/0006-supabase-auth.md)). Локально храним только бизнес-расширение профиля. `id` совпадает с `auth.users.id` из Supabase.

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY,                       -- = auth.users.id (Supabase)
    email           CITEXT UNIQUE NOT NULL,                 -- денорм из auth.users для удобства
    plan            VARCHAR(16) DEFAULT 'free',             -- free | pro | business
    org_id          UUID,                                   -- мульти-тенант (Phase 4)
    role            VARCHAR(16) DEFAULT 'user',             -- user | admin
    requests_used   INT DEFAULT 0,                          -- для биллинга
    requests_limit  INT DEFAULT 1000,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: пользователь видит только свою запись
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own ON users FOR SELECT USING (auth.uid() = id);
```

Lazy provisioning: при первом запросе с валидным Supabase JWT, если `users.id` отсутствует — backend делает `INSERT ... ON CONFLICT DO NOTHING`.

## Neo4j graph схема

Узлы: `:Company`, `:Person`, `:Tender`, `:Address`, `:Phone`, `:Domain`.

Связи:
- `(:Person)-[:ROLE {role, from, to}]->(:Company)`
- `(:Company)-[:LOCATED_AT]->(:Address)`
- `(:Company)-[:AWARDED]->(:Tender)`
- `(:Tender)-[:ISSUED_BY]->(:Company)`
- `(:Company)-[:OWNS_PHONE]->(:Phone)`
- `(:Company)-[:OWNS_DOMAIN]->(:Domain)`
- `(:Person)-[:RELATED_TO {kind, evidence}]->(:Person)` — OSINT-выявленные связи

Postgres остаётся source of truth для атрибутов сущностей; Neo4j хранит только id + связи. Синхронизация через события (`EntityExtracted` → graph upsert).

## Dedup и сущностное разрешение

- **Companies**: ключ = `country + bin/ogrn/inn`. При отсутствии — fuzzy: `name_normalized` + регион + директор + телефон/домен. Решающий шаг через `Task.DEDUPE_DECISION` (LLM) на спорных кейсах.
- **Persons**: ключ = `country + iin`. Иначе — `full_name + дата рождения` или граф связей.

Подробнее в [06-osint-pipeline.md](06-osint-pipeline.md).

## Изменения и история (CDC)

Простой `companies_changes` table:

```sql
CREATE TABLE companies_changes (
    company_id      UUID REFERENCES companies(id),
    field           VARCHAR(64),
    old_value       JSONB,
    new_value       JSONB,
    detected_at     TIMESTAMPTZ DEFAULT NOW(),
    source_page_id  UUID REFERENCES pages(id)
);
CREATE INDEX changes_company_time_idx ON companies_changes(company_id, detected_at DESC);
```

Тригерится в Extraction Agent при обнаружении diff с текущей версией.

## Расширения PostgreSQL (что включить)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
```

(Neon, Supabase, Railway Postgres — все поддерживают.)
