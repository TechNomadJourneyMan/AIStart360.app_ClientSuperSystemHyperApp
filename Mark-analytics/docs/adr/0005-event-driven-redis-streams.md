# ADR-0005: Event-driven через Redis Streams в MVP

- Status: Accepted (2026-05-24)
- Related: [ADR-0004](0004-arq-instead-of-celery.md)

## Контекст

8 bounded-contexts должны общаться **через события**, не direct calls. Нужна шина:
- At-least-once delivery
- Consumer groups (несколько воркеров одного агента)
- Ordering в рамках одного aggregate-id
- TTL/retention

Варианты:
1. **Redis Streams** (уже в стеке через Arq + cache)
2. **NATS JetStream** — отдельный сервис, мощнее
3. **Kafka** — overkill для MVP
4. **PostgreSQL LISTEN/NOTIFY** — ограничения по payload и persistence
5. **RabbitMQ** — отдельный сервис, sync-friendly

## Решение

**Redis Streams** в MVP и Phase 2. Миграция на NATS JetStream в Phase 3 при росте throughput > 10k events/sec или необходимости complex routing.

### Дизайн

- Один stream на тип события: `events:company_discovered`, `events:page_fetched`, `events:entity_extracted`.
- Consumer group на агента: `cg:discovery`, `cg:crawl`, `cg:extraction`.
- Outbox pattern: события сначала пишутся в `domain_events` таблицу Postgres в одной транзакции с бизнес-данными → отдельный `OutboxPublisher` шлёт в Redis Stream.
- Идемпотентность: каждый агент держит таблицу `processed_events (event_id, agent_name)`.
- Retention: 7 дней через `MAXLEN ~10000`.

## Последствия

**Плюсы**:
- Redis уже есть — нулевая дополнительная инфраструктура.
- Consumer groups дают параллелизм воркеров.
- Outbox гарантирует at-least-once (сохранили событие — обязательно опубликуем).
- Простой mental model.

**Минусы**:
- Redis не designed for high-throughput streaming (Kafka/NATS лучше для миллионов событий/сек).
- Persistence зависит от AOF/RDB настроек Redis (mitigation: используем Upstash с persistence).
- Нет встроенного schema-registry (mitigation: Pydantic-схемы событий в `app/events/`).

## Когда пересматривать

- Throughput > 10k events/сек.
- Нужен complex routing (topic exchanges, headers).
- Нужны retention > 30 дней.
- Кросс-региональная репликация.

→ Переход на **NATS JetStream** (легче Kafka, нативно cloud).

## Альтернативы

- **Прямые HTTP-вызовы между сервисами** — отвергнут: tight coupling, нет replay.
- **PostgreSQL LISTEN/NOTIFY** — отвергнут: payload limit, нет consumer groups.
- **Kafka сразу** — отвергнут: ops-overhead в MVP.
