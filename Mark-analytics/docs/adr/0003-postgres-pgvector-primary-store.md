# ADR-0003: PostgreSQL + pgvector как основной store

- Status: Accepted (2026-05-24)

## Контекст

Нужно OLTP-хранилище (companies, tenders, users, …) + vector store для semantic search (embeddings компаний). Варианты:

1. Postgres + pgvector (всё в одном)
2. Postgres + dedicated vector DB (Qdrant / Pinecone / Weaviate)
3. NoSQL (MongoDB) + vector DB
4. Полностью managed (Supabase = Postgres + pgvector + auth)

## Решение

**PostgreSQL 16 + pgvector** как единое хранилище в MVP и Phase 2.

Конкретный хостинг: **Neon** (serverless Postgres, free tier 0.5 ГБ, scales по cores).

Расширения:
- `pgvector` — semantic search
- `pg_trgm` + `unaccent` — fuzzy text search и dedup
- `postgis` — гео (адреса)
- `pgcrypto`, `citext` — стандарт
- `vector_cosine_ops` через HNSW индекс

## Последствия

**Плюсы**:
- Один сервис, одна транзакция — embedding и метаданные пишутся вместе, нет рассинхрона.
- pgvector справляется до 5–10M векторов (1024-dim) с p95 < 50 ms — этого хватит на 2 года.
- Joins между фильтрами (industry, country) и vector search в одном запросе.
- Backup, мониторинг, миграции — стандартные Postgres tools.
- Neon serverless: scale-to-zero, дешёвый dev/staging.

**Минусы**:
- При очень больших объёмах (>20M векторов) pgvector становится медленнее dedicated решения.
- Нет встроенной филтрации в HNSW при огромных фильтрах (mitigation: pre-filter индексами + post-rerank).

## Когда пересматривать

- Объём embeddings > 10M в одной таблице.
- p95 семантического поиска > 200 ms.
- Тогда добавить **Qdrant Cloud** как отдельный vector store, синхронизация через события.

## Альтернативы

- **Supabase** — отвергнут: более expensive чем Neon на масштабе, не нужен встроенный auth (своя реализация).
- **MongoDB + Pinecone** — отвергнут: split storage = больше ops, дороже на старте.
- **Только Qdrant с самого начала** — отвергнут: дублирование данных (атрибуты в Postgres, векторы в Qdrant), сложнее транзакции.
