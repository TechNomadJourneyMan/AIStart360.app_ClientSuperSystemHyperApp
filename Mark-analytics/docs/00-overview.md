# 00 — Overview

## Что мы строим

Mark Analytics — **AI-native платформа бизнес-разведки для рынка Казахстана и СНГ**: непрерывный сбор, нормализация, обогащение и мониторинг данных о юридических лицах, ИП, тендерах, инвестициях, людях, продуктах, отзывах, новостях. По сути — Palantir-lite × Crunchbase × Apollo × ZoomInfo × PitchBook, заточенный под локальные источники (Kompra, Adata, e-gov.kz, statbur, EGRUL/EGRIP, 2GIS, Kolesa, Krisha, Halyk-tendery, OFD-данные и т. д.).

## Принципы (важны → их нарушение даёт системе боль)

1. **Provider-agnostic AI.** Никаких прямых вызовов одного провайдера из бизнес-логики. Всё идёт через `app.ai.gateway`. Завтра OpenRouter поднимет цены — переключаемся за один env-флаг.
2. **Дёшево по умолчанию.** Каждый AI-вызов проходит **Model Router**, который выбирает самую дешёвую viable-модель под задачу. Использование дорогих моделей (Gemini 2.5 Pro, Claude Sonnet) — осознанное и логируется в `ai_call_log`.
3. **Кэш везде.** 70% AI-вызовов — это повторы (тот же URL, тот же текст). Semantic cache + key-based cache даёт x3–x10 экономии.
4. **Eventual, не realtime.** Discovery → Crawl → Extract → Enrich — это асинхронный конвейер на очередях. UI читает уже готовые проекции (read models), не дёргает AI на каждый клик.
5. **Локальный фронт-контракт стабилен.** Next.js фронт уже задеплоен. Бэкэнд не ломает контракты — REST `v1` фиксирован, breaking changes идут через `v2`.
6. **Append-only ingest.** Никогда не удаляем сырые HTML/JSON, которые скачали — кладём в R2/B2. Это даёт re-processing при смене моделей или фикса парсера без повторного crawl.
7. **Идемпотентность.** Каждый crawl-job, каждый AI-call — идемпотентны по детерминированному ключу. Можно безопасно перезапустить любую задачу.
8. **Observability обязательна.** Каждый AI-вызов: модель, токены_in/out, латентность, стоимость, cache_hit, prompt_version — в `ai_call_log`. Без этого нельзя оптимизировать стоимость.

## Что НЕ делаем (anti-scope)

- ❌ Не пишем свой LLM-runtime — используем OpenRouter и Google AI Studio API.
- ❌ Не разворачиваем K8s на старте. Railway/Fly.io до тех пор, пока не упрёмся.
- ❌ Не делаем мобильное приложение в Phase 1.
- ❌ Не строим payment-биллинг до Phase 3 — фронт уже на Vercel, биллинг присоединим через Stripe/Lemon Squeezy позже.
- ❌ Не делаем human-in-the-loop UI для разметки до Phase 2.
- ❌ Не пишем собственный crawler-фреймворк — берём Scrapy + Playwright + Crawlee (через Apify SDK Python где нужно).

## Целевая аудитория системы (для кого фичи)

- **Sales/BD-команды** — список ЛПР, контакты, сигналы о найме, тендеры.
- **M&A / VC-аналитики** — финансовые показатели, изменения учредителей, динамика выручки.
- **Маркетологи** — конкурентный мониторинг, отзывы, реклама.
- **Risk-комплаенс** — связи, бенефициары, судебные дела, санкционные списки.
- **Журналисты-расследователи** — графовая навигация по связям, OSINT-агрегация.

## Метрики успеха

| Метрика | Цель MVP (3 мес) | Цель GA (12 мес) |
|---------|------------------|-------------------|
| Покрытие компаний КЗ | 500K | 2M |
| Покрытие компаний СНГ | 1M | 10M |
| Freshness (median age of last update) | < 30 дней | < 7 дней |
| AI-стоимость на 1 enrichment | < $0.005 | < $0.001 |
| API p95 latency | < 400ms | < 200ms |
| Crawl throughput | 50k страниц/день | 1M страниц/день |

## High-level data flow

```
External sources                     Mark Analytics                       Frontend (Vercel)
─────────────────                   ─────────────────                    ─────────────────

[Gov registries]  ─┐
[2GIS / Maps]      ├──> Discovery ──> Crawl ──> Extraction ──> Enrich ──> Postgres ──> REST API ──> Next.js
[News / Telegram]  ├──> Agent       Workers     Agent (LLM)   Agent       + pgvector              dashboard
[Tenders]          │                  │           │             │           + Neo4j
[Social / OSINT]   ┘                  │           │             │           + R2 (raw HTML)
                                      ▼           ▼             ▼
                                   Raw HTML   Structured     Embeddings,
                                   in R2      records        graph edges,
                                                              tags, alerts
```

Подробности по слоям — [01-architecture.md](01-architecture.md).
