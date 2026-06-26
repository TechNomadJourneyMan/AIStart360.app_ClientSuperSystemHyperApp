# ADR-0004: Arq вместо Celery для задач

- Status: Accepted (2026-05-24)

## Контекст

Нужен job-queue для:
- Discovery (cron-tasks по источникам)
- Crawl (асинхронные jobs, минуты)
- Extract / Enrich (короткие async-tasks)
- Alerts evaluation (cron)

Варианты:
1. **Celery** — стандарт, sync-native, мощный, но тяжёлый
2. **Arq** — async-native, Redis-backed, минималистичный
3. **Dramatiq** — sync, чище Celery, но не async
4. **Taskiq** — async, моложе, не так распространён
5. **RQ** — Redis-based, sync, простой
6. **Temporal** — workflow engine, мощный, но overkill

## Решение

**Arq** (`arq` Python package).

Причины:
- Native async (FastAPI у нас async — гомогенный stack).
- Redis уже нужен для cache и rate-limit → не плодим инфраструктуру.
- API проще Celery: `@worker.task`, никаких bind/canvas/chord.
- Cron-tasks встроены.
- Достаточен до ~1000 задач/сек — нам хватит.

## Последствия

**Плюсы**:
- Меньше boilerplate, чем Celery.
- Гомогенный async stack — нет смены контекста sync↔async.
- Хорошо работает с FastAPI lifespan.
- Один Redis на всё.

**Минусы**:
- Меньше features, чем Celery (нет chains/groups встроенных — пишем вручную через events).
- Меньшее сообщество, меньше Stack Overflow.
- Нет встроенного UI для мониторинга очередей (mitigation: пишем простой dashboard в админке Phase 2 или используем `arq-cli` / Redis Insight).

## Когда пересматривать

- Объём > 5000 задач/сек.
- Нужны сложные workflow (saga pattern) — переход на **Temporal**.
- Нужны критичные task chains с гарантиями exactly-once — переход на **NATS JetStream** + кастомный consumer.

## Альтернативы

- **Celery** — отвергнут: sync-native, разрыв с FastAPI async.
- **Temporal** — отвергнут: overkill для MVP, дорогой ops.
- **Dramatiq** — отвергнут: sync, не наш кейс.
