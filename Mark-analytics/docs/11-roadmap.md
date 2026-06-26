# 11 — Roadmap (6 месяцев)

## Принципы планирования
- Каждый месяц = одна крупная цель. Не пять.
- Каждый спринт (2 недели) = одна demoable фича.
- Production-ready после каждого спринта (не «доделаем в конце»).

## Месяц 1 — Foundation

**Цель**: запущенный API с минимальной функциональностью, первый источник.

### Спринт 1.1 (нед. 1–2)
- [ ] Backend scaffold (FastAPI, config, logging, security, healthcheck)
- [ ] Postgres + миграции (companies, pages, ai_call_log, users)
- [ ] Auth: register/login/JWT
- [ ] AI Gateway: интерфейс + OpenRouter provider + Google AI Studio provider + key-cache
- [ ] Деплой на Railway, env-секреты, healthcheck зелёный
- [ ] Deliverable: `POST /auth/register`, `GET /companies` (пустой), `/docs`

### Спринт 1.2 (нед. 3–4)
- [ ] Crawler framework (BaseSpider, R2 upload, pages table)
- [ ] Первый spider: `kz_goszakup` (есть API, проще всего)
- [ ] Arq worker, периодический `discovery → crawl → extract` flow
- [ ] Extraction Agent: rule-based для goszakup
- [ ] LLM-extraction fallback через AI Gateway
- [ ] Deliverable: 10 000 тендеров в БД, отображаются через `/tenders`

## Месяц 2 — Companies & Search

**Цель**: понимаем «что есть на рынке КЗ».

### Спринт 2.1
- [ ] Spider: `kz_kompra` (HTML парсинг) — 200K компаний
- [ ] Extraction Agent с LLM (Gemini Flash) + provenance
- [ ] Entity Resolution v1: blocking + weighted scoring + `Task.DEDUPE_DECISION`
- [ ] Embedding companies через `bge-m3` (CPU local)
- [ ] Deliverable: 100K KZ-компаний с дедупом

### Спринт 2.2
- [ ] `POST /search` semantic + lexical hybrid
- [ ] `GET /companies/{id}` с field_provenance
- [ ] Frontend интеграция: список + детальная страница
- [ ] Базовая трассировка (Sentry / Logfire)
- [ ] Deliverable: рабочий поиск «компании по запросу»

## Месяц 3 — Crawl scale, Alerts MVP

**Цель**: regular updates + alerts.

### Спринт 3.1
- [ ] Spider: `kz_2gis` (Playwright + proxy)
- [ ] Refresh policy: автоматический re-crawl по `min_age`
- [ ] `companies_changes` (CDC) + `GET /companies/{id}/changes`
- [ ] Spider: `ru_egrul` (миллионы записей, осторожно)

### Спринт 3.2
- [ ] Alert Agent: правила + delivery (Telegram + Email)
- [ ] `POST /alerts`, `GET /alerts/{id}/events`
- [ ] Trends MVP: материализованные views по отраслям и регионам
- [ ] Cost monitoring дашборд (Grafana или встроенный)
- [ ] Deliverable: «оповещай меня о новых ИТ-компаниях в Алматы» работает end-to-end

## Месяц 4 — Graph & OSINT

**Цель**: связи и навигация.

### Спринт 4.1
- [ ] Neo4j AuraDB + sync через события
- [ ] `GET /companies/{id}/graph` (depth 1-2)
- [ ] OSINT entity linking: упоминания в новостях → companies/persons
- [ ] Spider: 3 новостных источника (forbes.kz, kursiv, rbc)

### Спринт 4.2
- [ ] Persons API: `/persons`, `/persons/{id}` с role_history
- [ ] Spider: Telegram-каналы (t.me/s/)
- [ ] Sanctions sync (OFAC, ЕС, ООН)
- [ ] Risk badges на профиле компании

## Месяц 5 — Enrichment depth

**Цель**: ширина → глубина.

### Спринт 5.1
- [ ] Vision OCR для PDF (тендерная документация, выписки)
- [ ] Spider: судебные дела (court.gov.kz, sudact.ru)
- [ ] Phone/domain ownership graph (для cluster detection)
- [ ] Spider: вакансии (HeadHunter, hh.kz) → сигналы роста

### Спринт 5.2
- [ ] Summarization Agent → `/companies/{id}/summary`
- [ ] Investment Thesis (premium endpoint, Gemini Pro)
- [ ] Semantic cache в проде, измерить hit rate
- [ ] Performance pass: API p95 < 400 ms

## Месяц 6 — Multi-tenant, billing, polish

**Цель**: готовность к платным клиентам.

### Спринт 6.1
- [ ] Multi-tenant (organization layer, role-based access)
- [ ] Stripe / Lemon Squeezy биллинг
- [ ] Plan limits (free / pro / business): запросы, alerts, export
- [ ] Export: CSV, JSON, parquet

### Спринт 6.2
- [ ] Webhooks для интеграций
- [ ] Public API для интеграторов (с rate limit per plan)
- [ ] Документация для разработчиков
- [ ] Onboarding flow в портале

## После месяца 6 (Phase 3+)

- ML-классификаторы вместо LLM на high-volume задачах (fine-tuned)
- Mobile API
- White-label для корпоративных клиентов
- Расширение в UZ, KG, RU полностью
- Свой GPU для embeddings и vision (когда cloud cost > $1k/мес)
- Real-time stream через NATS вместо Redis Streams

## Метрики, по которым меряем спринты

- **Velocity**: завершённых задач/спринт (целиться в 8–12)
- **Crawl coverage**: новых компаний/неделя
- **AI cost per processed entity**: тренд должен падать
- **API p95 latency**: тренд не должен расти
- **Error rate**: < 1%
- **Test coverage**: > 70% на новом коде

## Антипаттерны (не делать)

- ❌ Гнать сразу все 20 источников — стабилизируем сначала 3 ключевых.
- ❌ Делать UI без бэка готового — фронт уже есть, наша задача API.
- ❌ Premature scaling (K8s, dedicated DB) — пока на Railway/Neon.
- ❌ Перфекционизм в дедупе — 5% false positives ок для MVP, фиксим в HITL queue.
- ❌ Свои LLM раньше времени — cloud API дешевле, пока не докажете обратное.
