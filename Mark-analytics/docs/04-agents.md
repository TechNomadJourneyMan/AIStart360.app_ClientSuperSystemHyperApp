# 04 — Multi-Agent Architecture

## Два уровня агентов

| Уровень | Где живут | Модели | Когда работают |
|---------|-----------|--------|----------------|
| **Dev-агенты** (разработка) | `.claude/agents/*.md` | Claude Opus 4.7 | При работе с кодом (вы вызываете их) |
| **Runtime-агенты** (production) | `backend/app/agents/*.py` | Gemini / DeepSeek / Qwen | Постоянно, как воркеры |

Это критическое различие из ТЗ — **дорогие модели только для разработки, дешёвые в проде**.

---

## Dev-агенты (Claude Opus, design-time)

8 specialized сабагентов в `.claude/agents/` — каждый со своей ролью, системным промптом, и набором разрешённых инструментов. Используются через Claude Code Task tool.

| # | Agent | Триггер | Owns |
|---|-------|---------|------|
| 1 | `system-architect` | "design X", "review architecture" | архитектурные решения, ADR, диаграммы |
| 2 | `backend-engineer` | "build API for X", "implement endpoint" | FastAPI, SQLAlchemy, Pydantic |
| 3 | `crawl-engineer` | "scrape X", "add source X" | Scrapy/Playwright, anti-bot |
| 4 | `ai-engineer` | "add prompt for X", "tune model routing" | AI Gateway, prompts, embeddings |
| 5 | `osint-engineer` | "link entities", "OSINT for X" | graph, entity resolution |
| 6 | `frontend-engineer` | работает с Next.js фронтом | UI, dashboards |
| 7 | `devops-engineer` | "deploy X", "set up CI" | Railway/Fly, Docker, CI/CD |
| 8 | `security-engineer` | "audit X", "threat model" | auth, secrets, audit logs |

Полные конфиги в `.claude/agents/*.md`. Подробности использования — [12-multi-agent-dev.md](12-multi-agent-dev.md).

---

## Runtime-агенты (production, дешёвые модели)

Каждый runtime-агент:
- наследуется от `app.agents.base.BaseAgent`
- получает задания из Redis Streams (одна стрим = одна тема)
- вызывает AI Gateway с конкретным `Task` (Router выберет модель)
- пишет результат в БД и публикует событие
- идемпотентен по `job_id`

### Список

```
                              ┌──────────────┐
                              │ Orchestrator │ ← Arq scheduler, не AI агент
                              └──────┬───────┘
                                     │ enqueues
        ┌────────────────────────────┼───────────────────────────┐
        ▼                            ▼                           ▼
┌──────────────┐            ┌──────────────┐            ┌──────────────┐
│  Discovery   │ ─emit──►   │    Crawl     │ ─emit──►   │  Extraction  │
│   Agent      │            │    Agent     │            │    Agent     │
└──────────────┘            └──────────────┘            └──────┬───────┘
                                                                │ emits EntityExtracted
                                                                ▼
                            ┌──────────────┐            ┌──────────────┐
                            │   Trend      │ ◄──read──  │ Classification│ ── emit ►   ┌──────────┐
                            │   Agent      │            │     Agent     │             │  Alert   │
                            └──────────────┘            └──────────────┘             │  Agent   │
                                                                                      └──────────┘
                            ┌──────────────┐
                            │Summarization │ ◄── on-demand by API or worker
                            │    Agent     │
                            └──────────────┘
```

### 1. Discovery Agent

**Цель**: найти новые сущности (компании, тендеры, людей) и положить URL/ID в очередь Crawl.

- **Источники**: gov-registry индексы, sitemap.xml, поисковики, RSS-фиды, Telegram-каналы.
- **AI задачи**:
  - `Task.CLASSIFY_INDUSTRY` (mini) — фильтр релевантных компаний.
  - `Task.DETECT_LANGUAGE` — не AI, fasttext локально.
- **Output event**: `CompanyDiscovered { source, external_id, hint_url }`

### 2. Crawl Agent

**Цель**: скачать страницу/документ, сохранить raw в R2, выкатить событие `PageFetched`.

- **Стек**: Scrapy + Playwright + crawlee-python для антибота.
- **AI задач почти нет** — это инфраструктурный агент.
- **Output**: запись в `pages` (url, status, html_r2_key, screenshot_r2_key, fetched_at).

### 3. Extraction Agent

**Цель**: превратить raw HTML/PDF в структурированные сущности.

- **Стратегия**:
  1. Сначала пытаемся CSS-rule-based парсер (если источник знакомый).
  2. Если не получилось / источник новый → LLM-extraction через `Task.EXTRACT_COMPANY` / `EXTRACT_TENDER`.
  3. PDF/изображения → `Task.OCR_DOCUMENT` (vision model).
- **Output events**: `EntityExtracted { entity_type, fields, source_page_id, confidence }`

### 4. Classification Agent

**Цель**: проставить ярлыки (отрасль, размер, регион, теги), вычислить embedding.

- **AI задачи**:
  - `Task.EMBED_COMPANY_PROFILE` — локальный BGE-M3 (бесплатно).
  - `Task.CLASSIFY_INDUSTRY` — Gemini Flash 8B.
  - `Task.TAG_CONTENT` — для свободных тегов.
- **Output**: апдейт `companies` (industry, tags, embedding); событие `EntityEnriched`.

### 5. Trend Agent

**Цель**: пересчёт агрегаций по времени (количество новых компаний в отрасли, средняя выручка, активность тендеров).

- **AI задач почти нет** — это SQL aggregations + materialized views.
- **AI используется только для `Task.ANOMALY_EXPLANATION`**: «почему резкий рост?»
- **Output**: записи в `trend_snapshots`.

### 6. Alert Agent

**Цель**: проверить правила алертов против новых событий и доставить нотификации.

- **Стек**: rule-engine на основе JSON-rules + cron.
- **AI задачи**:
  - `Task.SUMMARIZE_NEWS` — для сборки текста нотификации.
- **Output**: события `AlertFired { rule_id, entity_id, channel, payload }` + доставка в Slack/Email/Telegram/webhook.

### 7. Summarization Agent

**Цель**: on-demand суммаризация (профиль компании, дайджест новостей, отчёт по тендеру).

- Вызывается:
  - REST endpoint `/companies/{id}/summary` (с кэшем 24ч).
  - Воркером — для нотификаций.
- **AI задачи**: `Task.SUMMARIZE_NEWS`, `Task.SUMMARIZE_REVIEWS`, `Task.INVESTMENT_THESIS` (на дорогих pro-планах).

---

## Базовый класс агента

```python
# backend/app/agents/base.py
from abc import ABC, abstractmethod

class BaseAgent(ABC):
    name: str                      # 'discovery', 'extraction', ...
    task_topic: str                # Redis stream key
    concurrency: int = 1

    @abstractmethod
    async def handle(self, job: AgentJob) -> AgentResult: ...

    async def emit(self, event: DomainEvent) -> None: ...
    async def log_metrics(self, result: AgentResult) -> None: ...
```

См. реализацию в `backend/app/agents/base.py` (после scaffold).

---

## Event-driven backbone

- **Транспорт MVP**: Redis Streams (один stream на событие, consumer group на агента).
- **Outbox pattern**: события пишутся в `domain_events` таблицу одной транзакцией с бизнес-данными, отдельный publisher шлёт их в Redis.
- **Idempotency**: каждый агент держит таблицу `processed_events (event_id, agent_name)`.
- **Phase 2**: переход на NATS JetStream при росте throughput > 10k events/sec.

## Memory architecture (как требует ТЗ)

| Уровень | Хранилище | Use case |
|---------|-----------|----------|
| Short-term | Redis | working memory агента в рамках задания, rate-limit |
| Long-term | Postgres + pgvector | факты, embeddings, история взаимодействий |
| Knowledge graph | Neo4j AuraDB | связи компания↔человек↔тендер↔адрес |

Agents читают/пишут память через `app.memory.*` модули (фасады над тремя хранилищами).

## Когда добавлять нового runtime-агента

Триггеры:
- Новый класс источников требующий специфичной обработки (например, телефонные регистры → отдельный `PhoneVerifyAgent`).
- Новая бизнес-задача без существующего шаблона (например, `ScreeningAgent` для санкционных списков).
- Узкое горло конкретного шага (extract стал бутылочным горлом → выделить vision-extraction в отдельный агент).

Не добавляем агента ради красоты. Если задача fit-в-один-вызов AI Gateway — это просто метод, а не агент.
