# 05 — Мультиагентная архитектура

Назначение: полное описание агентного слоя по решению D3 (+ D4, D7): агенты, права, жизненный цикл, события, безопасность, наблюдаемость, стоимость.
Обновлено: 2026-10-06

Статус: 🟡 частично реализовано. Рантайм (086), уведомления и одобрения (087) работают. Работают агенты `monitoring`, `document_intelligence`, `document_reaper`, пайплайн диагностики (090): `diagnostic_orchestrator` → `data_collection` → `metrics` → `data_quality` → `benchmark` → `diagnostic` → `recommendation`, и агент `report` (фаза 6, §2.2). Не сделан `admin_assistant` (позже). Код: `lib/agents/**`, `lib/diagnostics/**`, `lib/reports/**`.
Связанные: [03-database.md](03-database.md) (раздел 086), [07-admin-control-center.md](07-admin-control-center.md), [09-security.md](09-security.md).

## 1. Принципы

| # | Принцип | Источник |
|---|---|---|
| 1 | Определения агентов — код (`lib/agents/definitions/*.ts`), ревью через PR. Рантайм-настройки — `agent_configs` | D3 |
| 2 | Источник истины — БД-леджер (`agent_tasks`, `agent_runs`). Inngest — только триггер/планировщик | D3, D7 |
| 3 | Собственный рантайм на Inngest. Vercel Workflow — только omnichannel. n8n — опц. коннекторы через подписанный вебхук в `platform_events`, без бизнес-логики | D7 |
| 4 | Детерминированное — без LLM (оркестрация, сбор, метрики, бенчмарки, мониторинг). LLM — только где нужен смысл | D3 |
| 5 | Инструмент привязан к `company_id` задачи: агент не может адресовать другой тенант | D3 |
| 6 | Всё, что отправляет наружу, удаляет или меняет систему, — только через одобрение человека | D3 |
| 7 | Paperclip — не рантайм; заимствуем идеи (бюджеты, governance, heartbeats, оргструктура агентов, одобрения). OpenClaw — не используем в бэкенде | D7 |

## 2. Агенты v1

Бюджеты — стартовые предложения (утверждает владелец, правятся в `agent_configs`).

| Агент | Ответственность | Триггер | Инструменты | Права по умолчанию | Tier | Бюджет / запуск | Выход |
|---|---|---|---|---|---|---|---|
| `diagnostic_orchestrator` | Машина состояний сессии; ставит дочерние задачи; финализирует Overview | `ONBOARDING_COMPLETED`, `QUESTIONNAIRE_COMPLETED`, `FILE_PROCESSED`, ручной запуск | `session.read`, `session.update`, `task.enqueue` | READ_CLIENT_DATA, WRITE_CLIENT_DATA, EXECUTE_WORKFLOW | — (детерм.) | $0 | `diagnostic_sessions` (статус, `overview`), дочерние задачи, `DIAGNOSTIC_STARTED/COMPLETED` |
| `data_collection` | Снимок анкеты, компании, GRI, CRM; полнота | дочерняя; расписание (refresh) | `survey.read`, `company.read`, `gri.read`, `crm.snapshot` | READ_CLIENT_DATA, RUN_INTEGRATION (только чтение) | — | $0 | `diagnostic_sessions.sources`, `completeness` |
| `document_intelligence` | Preflight → parse → extract → маппинг полей; OCR или `needs_ocr` | `FILE_UPLOADED` | `storage.read`, `file.preflight`, `file.parse`, `llm.extract` | READ_FILES, PROCESS_FILES, CALL_LLM | standard | $0.30 | `documents.parsed_data`, `processing_stage`, `FILE_PROCESSED` |
| `data_quality` | Пропуски, дубли, невозможные значения, устаревание, противоречия | дочерняя; `METRIC_UPDATED` (debounce) | `metrics.read`, `survey.read`, `finding.create`, `llm.classify` (опц.) | READ_CLIENT_DATA, CREATE_FINDINGS, CALL_LLM | light (опц.) | $0.05 | находки `data_gap`/`anomaly` (CALCULATED/INFERRED) |
| `metrics` | Материализация + история | `FILE_PROCESSED`, `QUESTIONNAIRE_COMPLETED`, дочерняя | `metrics.materialize` | READ_CLIENT_DATA, UPDATE_METRICS | — | $0 | `metrics`, `metric_value_history`, `METRIC_UPDATED` |
| `benchmark` | Сравнение с бенчмарками из кода (с меткой источника) | дочерняя (после `metrics`) | `metrics.read`, `benchmark.read`, `finding.create` | READ_CLIENT_DATA, CREATE_FINDINGS | — | $0 | находки CALCULATED с `evidence.benchmark_source` |
| `diagnostic` | Правила → CALCULATED/INFERRED; LLM → AI_HYPOTHESIS (скрыты до ревью) | дочерняя (после data_quality, benchmark) | `finding.create`, `llm.analyze`, `metrics.read`, `document.facts.read` | READ_CLIENT_DATA, READ_FILES, CALL_LLM, CREATE_FINDINGS | standard | $0.40 | `diagnostic_findings`; `CRITICAL_RISK_FOUND` |
| `recommendation` | Рекомендации из находок, горизонты 30/90/180 | дочерняя (после diagnostic) | `finding.read`, `llm.analyze`, `recommendation.create` | READ_CLIENT_DATA, CALL_LLM, CREATE_FINDINGS | standard | $0.30 | `diagnostic_recommendations` (RECOMMENDATION) |
| `report` | Снимок `report_versions` + опц. premium-нарратив; PDF | `DIAGNOSTIC_COMPLETED`, ручной, «Нужны правки» эксперта | `report.snapshot`, `report.create_version`, `llm.narrative` | READ_CLIENT_DATA, CREATE_REPORT, CALL_LLM | premium (опц.) | $1.00 | `report_versions` (`in_review` + PDF), `REPORT_GENERATED`. Публикует клиенту только эксперт («Подтвердить») |
| `monitoring` | Зависшие/мёртвые задачи, расход бюджета, сбои интеграций и вебхуков, зависшие документы | cron `*/15`, `AGENT_FAILED`, `INTEGRATION_FAILED` | `health.read`, `notify.staff` | READ_CLIENT_DATA (агрегаты), SEND_TELEGRAM (только персоналу) | — | $0 | `notification_events` WARNING/CRITICAL |
| `admin_assistant` (позже) | Q&A по статистике платформы для персонала, только чтение | ручной (GIGA) | `stats.read` | READ_CLIENT_DATA (агрегаты), CALL_LLM | light | $0.05 | ответ |

### 2.1 Пайплайн диагностики — как реализовано (миграция 090)

| Шаг | Что происходит | Где |
|---|---|---|
| Запуск | `ONBOARDING_COMPLETED` (первое завершение анкеты), `QUESTIONNAIRE_COMPLETED` (повторная отправка), `FILE_PROCESSED` (если документ дал данные), ручной пересчёт (`POST /api/v1/diagnostics/recalculate`), запуск из GIGA. Оркестратор открывает сессию: не более одной активной на компанию. Повторный триггер ставит `rerun_requested`; после завершения новый проход запускается, только если данные менялись после начала сессии | `session.open`, `lib/diagnostics/sessions.ts` |
| Этапы | Каждый этап — отдельный агент со своими правами, бюджетом и историей запусков. Этап отмечает себя в `diagnostic_sessions.stages` и ставит следующий (`pipeline.advance`, идемпотентно `diag:<session>:<stage>`). Отключённый админом агент записывается как `skipped` | `lib/agents/definitions/diagnostics.ts` |
| Индекс | Те же правила, что у ручного пересчёта. Если результат совпал с текущим расчётом, используется текущая строка `diagnostics` (сохраняются её ИИ-анализ и история версий) | `lib/diagnostics/scoring.ts` |
| Выводы | `data_quality`: расхождение источников > 30 %, невозможные и устаревшие значения, необработанные документы. `benchmark`: отклонение ≥ 15 п. от ориентира отрасли с пометкой «экспертная оценка, не статистика рынка», confidence 0.5. У каждого вывода есть evidence. Повторный запуск заменяет набор вывода агента: прежние становятся `superseded`, неизменённые сохраняют ревью | `lib/diagnostics/quality.ts`, `benchmark.ts`, `findings-store.ts` |
| Модель | `diagnostic` и `recommendation` видят только список доказательств с id: баллы блоков, риски правил, метрики с источником, выводы. Контактных данных и сырых документов в нём нет, весь список изолирован как untrusted. Принимается только JSON, каждая гипотеза ссылается на существующие id: ссылка на неизвестный id отбрасывается, без ссылок отбрасывается вся гипотеза. Уверенность ≤ 0.7, `AI_HYPOTHESIS` скрыта от клиента до ревью | `lib/diagnostics/ai.ts` |
| Стоимость | Модель вызывается, только если задан ключ, укладывается бюджет (запуск / агент / компания / платформа) и данные изменились: хеш входа сравнивается с прошлой завершённой сессией. Иначе этап завершается без модели, а в записи этапа указано `llm: unavailable / budget / cached / failed` | `modelCall`, `diagnostics.ai_cache` |
| Сбои | Этап в dead-letter переводит сессию в `failed`. Сессия без живых задач дольше 15 мин переводится в `failed` при обслуживании очереди | `queue.ts afterRun`, `failStalledSessions` |
| Итог | Снимок Executive Overview в `diagnostic_sessions.overview`, `DIAGNOSTIC_COMPLETED` (индекс, критические выводы, файлы, метрики). Критические риски правил — одно уведомление команде на набор рисков. Критическая гипотеза ИИ — WARNING «нужна проверка» | `diagnostics.finalize`, `event-router.ts` |

### 2.2 Отчёт — как реализовано (085, фаза 6)

| Шаг | Что происходит | Где |
|---|---|---|
| Запуск | `DIAGNOSTIC_COMPLETED` (сессия события; чужая сессия отклоняется) или ручной запуск из GIGA (последняя `ready`-сессия). Права: READ_CLIENT_DATA, CREATE_REPORT, CALL_LLM (только для резюме) | `lib/agents/definitions/report.ts` |
| Снимок | `report.snapshot` собирает `report_versions.content` из БД: баллы и блоки строки `diagnostics` сессии, правила движка (CALCULATED, `engine:point_a_v1`), активные выводы и рекомендации, видимые клиенту; гипотезы ИИ и предложения модели — только после проверки сотрудником. У каждого пункта provenance, confidence, источник, evidence. Плюс полнота, пробелы, источники, дата расчёта. Непроверенное — только счётчик в `provenance.staff` | `lib/reports/snapshot.ts`, `lib/agents/tools/reports.ts` |
| Версия | `report.create_version` пересобирает снимок, сверяет хеш, пишет версию `in_review` (103; никогда `published`), один раз рендерит её PDF («Версия N · дата», водяной знак «На проверке эксперта») в приватный Storage (`pdf_storage_path`); прежние `draft`/`ready`/`in_review` → `superseded`, опубликованная не трогается. `data_hash` = sha256 канонической сериализации данных снимка без `generated_at` и резюме: те же данные → новой версии нет (это пишется в итог запуска). `REPORT_GENERATED` — один на версию (dedupe) | `lib/reports/versions.ts` |
| Резюме (опц.) | Выключено по умолчанию; включается `agent_configs.settings = {"narrative": true}`. Premium, бюджет запуска $1, 1 вызов; только при изменившихся данных. Модель видит снимок без названия компании, контактов, цитат evidence (fenced untrusted). Принимается, только если каждое число в тексте есть в данных; хранится как AI_HYPOTHESIS с моделью и версией промпта. Нет ключа / бюджета / прав / непроверяемые числа → версия без резюме, причина в `provenance.staff.narrative` | `lib/reports/snapshot.ts` (`acceptNarrative`) |
| Проверка экспертом | Решение владельца: PDF версии уходит эксперту, «Подтвердить» сразу публикует. `REPORT_GENERATED` (payload `status: 'in_review'`) → бот экспертов шлёт PDF с кнопками, email-копия с вложением (если задан `RESEND_API_KEY`), WhatsApp-шаблон `report_review` со ссылкой в кабинет экспертам с подтверждённым номером (если настроен Cloud API), версия видна в кабинете эксперта и в GIGA. Любой канал решает через `decideReportReview`: повторная проверка роли (`reports.review` / профиль expert·admin·super_admin), одобренного профиля, 2FA (веб — шлюз маршрута; Telegram — при `staff_require_mfa` нужен включённый второй фактор), статуса `in_review`; аудит до изменения; одно решение на версию, повтор — no-op. `approve` → `published` + отчёт клиенту (уведомление со ссылкой `/r/v/<token>` на эту версию) + финальный PDF без водяного знака. `changes_requested` → комментарий, версия `superseded` (`provenance.review`), задача агенту `report` через очередь (`input.review`, ключ идемпотентности `report_review:<review>`); если данные не изменились — новой версии нет, персонал уведомлён (`report.review_unchanged`); не более `agent_configs.settings.review_reruns_max` (по умолчанию 3, максимум 10) пересборок на сессию диагностики, дальше — уведомление персоналу (`report.review_rerun_cap`) | `lib/reports/review-flow.ts`, `review-delivery.ts`, `lib/telegram/bots/expert/review.ts` |
| Публикация (legacy) | Версии до 103 (`ready`): GIGA «Отчёты», право `reports.publish` (admin, super_admin), аудит до изменения. Публикация `ready` → `published`, прежняя опубликованная → `superseded`; отклонение (`ready`/`draft`/`in_review`) и отзыв — с причиной | `app/api/giga-admin/reports/**` |
| Клиент | `/api/v1/reports*` через сессию (RLS: только `published`) + явный фильтр `published` + `lib/tenancy`; «Версия N · дата» в карточке; PDF ровно этой версии — из Storage (рендер один раз на стадию, при недоступном Storage — в памяти); «Ссылка на эту версию» — подписанный HMAC-токен с истечением (`/r/v/<token>`, 30 дней, максимум 90; открывает только опубликованную и не отозванную версию) | `app/api/v1/reports/**`, `app/r/v/**`, `lib/reports/pdf-store.ts`, `version-link.ts` |

#### Хук для других каналов (WhatsApp, W6)

Не реализовано здесь; точки подключения — `lib/reports/review-delivery.ts`:
- `reportReviewRecipients(versionId)` — кто может решать по версии сейчас (одобренные, `reports.review`), с контактами: email, телефон (`profiles.phone`), chat id в боте экспертов, признак «эксперт, не администратор»; пусто, если версия не `in_review`;
- `reportReviewPackage(versionId)` — PDF (байты), имя файла, «Версия N · дата», строки текста, ссылки на кабинет эксперта и GIGA; `null`, если версия не `in_review`;
- либо подписка `onPlatformEvent` на `REPORT_GENERATED` с `payload.status === 'in_review'`.
Решение из любого нового канала — только через `decideReportReview` (`channel` пока `web` | `telegram`; новый канал требует расширить CHECK в 103).

Форма определения (код): `key`, `name`, `description`, `tier`, `tools[]`, `defaultPermissions{}`, `prompt` + `promptVersion`, `triggers` (события / cron), `limits` (`maxTokens`, `maxToolCalls`, `timeoutMs`, `maxAttempts`), `children[]` (кого может ставить в очередь).

## 3. Права

### 3.1 Решения и потолки

Решение по праву: **ALLOW** / **REQUIRE_APPROVAL** / **DENY**. Строгость: DENY > REQUIRE_APPROVAL > ALLOW.

```
effective(agent, perm) = strictest( CEILING[perm],  grant(agent, perm) ?? definition.defaultPermissions[perm] ?? DENY )
если аргументы действия получены из вывода LLM и perm ∈ {SEND_TELEGRAM→клиенту, SEND_EMAIL, MODIFY_SYSTEM, DELETE_DATA} → не мягче REQUIRE_APPROVAL
```

Админ может выставить любое значение не мягче потолка; ослабить потолок нельзя (проверка в API и в рантайме).

| Право | Потолок (код) | Ограничение области |
|---|---|---|
| READ_CLIENT_DATA | ALLOW | Только `company_id` задачи |
| WRITE_CLIENT_DATA | REQUIRE_APPROVAL | Данные, которые ввёл клиент (анкета, профиль компании). Агентам v1 не выдаётся. Служебные записи пайплайна (сессия, этапы) идут через EXECUTE_WORKFLOW, индекс Точки А — через UPDATE_METRICS |
| READ_FILES | ALLOW | Файлы компании задачи |
| PROCESS_FILES | ALLOW | Только `parsed_data`, `processing_stage`, `security_*` |
| CALL_LLM | ALLOW | Только через gateway, под бюджетом |
| UPDATE_METRICS | ALLOW | `source ∈ {document, calculated, resolver, external}`; `manual` — нельзя |
| CREATE_FINDINGS | ALLOW | AI_HYPOTHESIS всегда `visible_to_client=false` |
| CREATE_REPORT | ALLOW | Статусы draft/ready; `published` — только человек |
| RUN_INTEGRATION | ALLOW (чтение) | Запись во внешнюю систему → REQUIRE_APPROVAL |
| SEND_TELEGRAM | ALLOW только `audience=staff` | Клиенту → REQUIRE_APPROVAL |
| SEND_EMAIL | REQUIRE_APPROVAL | «EXTERNAL_COMMUNICATION» из D3 |
| EXECUTE_WORKFLOW | ALLOW | Постановка следующего этапа пайплайна (порядок задан в коде, `lib/diagnostics/pipeline.ts`) и учёт сессии/этапов |
| MODIFY_SYSTEM | REQUIRE_APPROVAL | Настройки, конфиги агентов, роли — никогда ALLOW |
| DELETE_DATA | REQUIRE_APPROVAL | Никогда ALLOW; агентам v1 не выдаётся |

### 3.2 Инструменты

Каждый инструмент: `name`, `description`, `inputSchema` (JSON Schema, совместима с MCP `tools/list`), `permission`, `handler(ctx, args)`. `ctx` содержит `company_id`, `task_id`, `run_id`, клиентов БД с service role; любой `company_id` в аргументах игнорируется. Аргументы и результат проходят zod; в `agent_tool_calls` пишутся `args_redacted` и `result_summary`.

## 4. Жизненный цикл

### 4.1 Задача и запуск

```
   enqueue(idempotency_key) ──► [queued] ──claim (FOR UPDATE SKIP LOCKED; lease_token, lease_until)──► [running]
                                  ▲   ▲                                                                 │
     reaper: lease_until < now ───┘   │                                                                 ├─► [succeeded]
     (attempts < max)                 │                                                                 │
                                      ├── retry: run_after = now + backoff ◄── [failed] ◄───────────────┤ ошибка / таймаут /
                                      │                                         │ attempts ≥ max         │ BUDGET_EXCEEDED
                                      │                                         ▼                        │
                                      │                                      [dead] (DLQ) ─► AGENT_FAILED│
                                      │                                                                  │ инструмент требует
                                      └── approve (re-queue, payload_hash) ◄── [awaiting_approval] ◄─────┘ одобрения
                                                                               │ reject / expire
                                                                               ▼
                                                                          [cancelled]          админ: cancel из любого не финального
```

| Параметр | Значение (предложение) |
|---|---|
| `max_attempts` | 3 (определение может переопределить) |
| Backoff | `min(30 c · 2^(attempts−1), 30 мин)` + jitter |
| Lease | `timeoutMs` определения + 60 c |
| Reaper | cron каждую минуту (Inngest) или `/api/cron/agents` |
| Идемпотентность | `idempotency_key` UNIQUE, напр. `document_intelligence:FILE_UPLOADED:<document_id>:<sha256>` |
| Конкурентность | Не более 1 `running` на `(agent_key, company_id)` |
| Запуск (`agent_runs`) | Одна строка на попытку: running → succeeded \| failed \| cancelled. При запросе одобрения запуск завершается `succeeded` с `output_summary` «ожидает одобрения», задача → `awaiting_approval` |

### 4.2 Шаги раннера

1. Claim задачи. 2. Проверка `agent_configs.enabled`. 3. Budget guard: запуск, агент/день, компания/день, платформа/день. 4. `agent_runs` (running). 5. Хендлер определения с `ctx` (инструменты, gateway, `emit`). 6. На каждый вызов инструмента: permission engine → `agent_tool_calls`; при REQUIRE_APPROVAL → `agent_approvals` + `APPROVAL_REQUESTED`. 7. Завершение: токены, стоимость, `output_summary`; задача → succeeded / retry / dead. 8. После одобрения: повторный запуск исполняет действие только если `payload_hash` совпадает и срок не истёк → approval `executed`.

### 4.3 Inngest

| Функция | Триггер | Что делает |
|---|---|---|
| `agents-task-requested` | event `agents/task.requested` | Запускает конкретную задачу |
| `agents-maintenance` | cron `* * * * *` | Ставит задачи агентам по расписанию, переотправляет недоставленные `platform_events`, reaper просроченных lease, истечение одобрений, drain due-задач |
| (в `emitPlatformEvent` → `dispatchEvent`) | запись события | По карте подписок ставит задачи подписанным агентам (идемпотентно на событие) |
| Fallback | Vercel cron `/api/cron/agents` | Тот же maintenance/drain, если Inngest не настроен (`CRON_SECRET` только в заголовке) |

Имена функций — по коду Phase 7 (в работе: `lib/functions/agents.ts`, `lib/events/platform.ts`).

Обязательно `triggers: [{ event }]` / `[{ cron }]` (inngest 4.x игнорирует `event`/`cron` верхнего уровня — причина 3 мёртвых функций) + тест регистрации по образцу `tests/unit/omnichannel/inngest-registration.test.ts`.

## 5. События (event-driven)

`emitPlatformEvent(name, {company_id, subject_type, subject_id, payload})` пишет в `platform_events` (outbox) и отправляет в Inngest. Карта подписок — в коде.

| Событие | Источник | Подписчики (агенты) | Уведомление (уровень) |
|---|---|---|---|
| `CLIENT_CREATED` | регистрация / GIGA | — | INFO (staff) |
| `ONBOARDING_COMPLETED` | анкета 12/12 | diagnostic_orchestrator | SUCCESS (staff) |
| `QUESTIONNAIRE_COMPLETED` | повторное заполнение / правка анкеты | diagnostic_orchestrator (refresh), metrics | — |
| `FILE_UPLOADED` | finalize-эндпоинт (088) | document_intelligence | — |
| `FILE_PROCESSED` | document_intelligence | metrics, diagnostic_orchestrator | — |
| `DIAGNOSTIC_STARTED` | diagnostic_orchestrator | (дочерние ставятся напрямую) | INFO |
| `DIAGNOSTIC_COMPLETED` | diagnostic_orchestrator | report | SUCCESS (staff) |
| `METRIC_UPDATED` | metrics | data_quality (debounce на компанию) | — |
| `REPORT_GENERATED` | report | — | SUCCESS (staff); эксперты: PDF + кнопки в боте экспертов, email с вложением (`status: 'in_review'`) |
| `AGENT_FAILED` | раннер (task → dead) | monitoring | WARNING / CRITICAL |
| `INTEGRATION_FAILED` | синк CRM, вебхуки | monitoring | WARNING |
| `CRITICAL_RISK_FOUND` | diagnostic | — | CRITICAL (staff); клиенту — не автоматически |
| `APPROVAL_REQUESTED` | раннер | — | APPROVAL_REQUIRED (Telegram-карточка + GIGA) |

## 6. Безопасность и prompt injection

| # | Правило | Основа в коде сегодня |
|---|---|---|
| 1 | Текст документов, CRM, интеграций, свободные ответы клиента — только внутри `<untrusted_document>` / `<untrusted_data>` с экранированием закрывающих тегов; никогда в system prompt | `lib/documents/extract.ts:251-283`, `lib/journey/prompt.ts:51-60`. Нарушают: `extract-rows.ts:532-540,572-579`, `bind-fields-ai.ts:175-187`, `report-chat/prompt.ts:84-90` — исправить до переноса в агентов |
| 2 | Набор инструментов фиксирован определением + grants; вывод модели не добавляет инструменты и не меняет тенант | — |
| 3 | Вывод модели — zod; числа: границы, единицы, период; при ошибке — повтор с обратной связью, затем failed | `lib/ai/structured.ts:55-140` |
| 4 | LLM не может инициировать SEND_*/DELETE_DATA/MODIFY_SYSTEM без одобрения | — |
| 5 | Нет секретов в промптах; минимизация PII (`maskPii`); редакция в `args_redacted`, `error_message`, `agent_events.data` | `lib/assistant/gree-chat.ts:54,151` |
| 6 | AI_HYPOTHESIS ссылается на существующие `evidence` (проверка ссылок, как verbatim-цитаты в omnichannel) | `lib/omnichannel/ai.ts` |
| 7 | Детектор инъекций на входе (regex) → `agent_events` warn, понижение confidence | `lib/omnichannel/guardrails.ts:53-55` |
| 8 | Одобрение исполняется только при совпадении `payload_hash` и до `expires_at` | паттерн fence из 066 |
| 9 | Callback Telegram: HMAC, срок, право `approvals.decide`, аудит | см. [07](07-admin-control-center.md) |
| 10 | Бюджеты: превышение → задача failed `BUDGET_EXCEEDED` + WARNING | D3 |

## 7. Наблюдаемость

| Запрошенное поле | Колонка |
|---|---|
| run_id | `agent_runs.id` |
| agent_id | `agent_runs.agent_key` + `agent_version` |
| task_id | `agent_runs.task_id` |
| client_id | `agent_runs.company_id` |
| started_at / finished_at | `started_at`, `finished_at` (+ `duration_ms`) |
| status | `agent_runs.status` (+ `agent_tasks.status`) |
| input_summary | `input_summary` (редактированный) |
| tools_used | `tools_used text[]` |
| tool_calls | строки `agent_tool_calls` по `run_id` (seq, tool, permission, decision, status, duration) |
| model | `model` — точный id, возвращённый OpenRouter; `tier` |
| model_version | входит в id модели OpenRouter; версия промпта — `prompt_version` |
| tokens | `tokens_in`, `tokens_out`, `llm_calls` |
| cost | `cost_usd` (из `usage.cost` OpenRouter) |
| output_summary | `output_summary` |
| errors | `error_code`, `error_message` (редактированный); `agent_events` level=error |
| источники | `sources jsonb` (ссылки на survey/document/metric/gri) |

Langfuse — опционально в gateway при наличии ключей (D7). Логи только структурированные (`agent_events`), без PII.

## 8. Стоимость

Gateway (`lib/ai/gateway.ts`): tier → модель (override из `agent_configs`), вызов OpenRouter, фактическая стоимость из `usage.cost`; таблица ориентировочных цен — конфигурируемая; проверка бюджетов до и после вызова.

| Tier | Модель (D3) | Для чего | Max output tokens / вызов | Вызовов на диагностику* | Стоимость на диагностику* (оценка) |
|---|---|---|---|---|---|
| light | `anthropic/claude-haiku-4.5` | Классификация, маршрутизация извлечения, краткие сводки, data_quality (опц.) | 1 000 | ≈ 8 | ≈ $0.04 (≈3k вх. / 0.5k вых. на вызов) |
| standard | `anthropic/claude-sonnet-4.5` | Извлечение из документов, анализ, находки, рекомендации | 4 000 (извлечение строк — чанками, не 8 000 одним вызовом) | ≈ 13 (10 на 5 документов + 2 diagnostic + 1 recommendation) | ≈ $0.75 (≈8–12k вх. / 2–3k вых. на вызов) |
| premium | `anthropic/claude-opus-4.8` | Только финальный нарратив отчёта, опционально | 4 000 | 0–1 | по прайсу OpenRouter; ограничено `per_run_budget_usd` агента `report` |
| — | детерминированные агенты | оркестрация, сбор, метрики, бенчмарки, мониторинг | — | — | $0 |

\* Оценка для одной диагностики с 5 документами; ориентир цен — $1 / $5 (Haiku 4.5) и $3 / $15 (Sonnet 4.5) за 1M входных / выходных токенов; сверить с OpenRouter `/models` перед запуском. Итого ≈ $0.8 без premium.

| Бюджет | Где хранится | Стартовое значение (предложение) | При превышении |
|---|---|---|---|
| На запуск | `agent_configs.per_run_budget_usd` | см. §2 | Запуск прерывается, задача failed `BUDGET_EXCEEDED` |
| Агент / день | `agent_configs.daily_budget_usd` | $20 для LLM-агентов | Новые задачи агента не берутся до конца суток; WARNING |
| Компания / день | `ai_budgets.company_daily_usd` (094), иначе env `AGENT_COMPANY_DAILY_BUDGET_USD` | $5 | Задачи компании ждут; WARNING |
| Платформа / день | `ai_budgets.platform_daily_usd` (094), иначе env `AGENT_PLATFORM_DAILY_BUDGET_USD` | $50 | Все LLM-задачи ждут; CRITICAL |
| Провайдер / день | `ai_providers.daily_budget_usd` (094), по умолчанию нет | — | Вызовы этого провайдера отклоняются (`BUDGET_EXCEEDED`), остальные работают |

Текущие вызовы вне агентов (омниканал на Opus 4.8, Journey на GPT-4o, pulse на Gemini через raw fetch) переводятся на gateway в Phase 7, чтобы учёт был полным.

### 8.1 Провайдеры моделей, маршрутизация и бюджеты (миграция 094)

Владелец добавляет OpenAI-совместимых провайдеров и их ключи API из админки и из Telegram-бота; оба вызывают один сервис `lib/ai/providers/service.ts` (мутации — право `settings.manage`, т.е. только Super Admin; расходы — `agents.view`). Таблицы закрыты для API-ролей (RLS, без грантов), читает только сервер.

| Таблица | Что хранит |
|---|---|
| `ai_providers` | ключ (`openrouter`, `alem`, …), тип (`openrouter` / `openai_compatible`), base URL, путь на каждую возможность (`chat_path`, `embeddings_path`, `rerank_path`, `ocr_mode`), несекретные заголовки, поддержка `response_format`, дневной бюджет, заметка о приватности |
| `ai_credentials` | ключи API: только шифртекст AES-256-GCM (`SECRETS_ENCRYPTION_KEY`) и последние 4 символа; статус последней проверки (ошибка без ключа) |
| `ai_models` | id модели у провайдера для возможности `chat` / `embeddings` / `rerank` / `ocr`, цены за 1M токенов, какой ключ использовать (NULL — первый включённый ключ провайдера) |
| `ai_routes` | возможность (+ уровень `light` / `standard` / `premium` для chat) → модель |
| `ai_budgets` | дневные бюджеты платформы и компании (NULL — из env) |

**Маршрутизация** (`lib/ai/providers/router.ts`, кэш ≤ 60 с на инстанс, сбрасывается при каждом изменении через сервис):

1. Явная модель (зашита в коде вызова или `agent_configs.model_override`) → провайдер, у которого эта модель зарегистрирована, иначе OpenRouter.
2. Иначе маршрут `ai_routes` для возможности и уровня. Функции вне агентов (`chatWithOpenRouter`) переводят сложность в уровень: low/medium → light, high → standard, max → premium.
3. Нет маршрута или он непригоден (выключен, нет ключа, ключ не расшифровывается) → встроенное поведение до 094: OpenRouter, модель уровня из `AI_MODEL_*` / по умолчанию, ключ `openrouter` из панели или `OPENROUTER_API_KEY`. Для rerank и OCR встроенного варианта нет.

Ключ модели: её собственный ключ → первый включённый ключ провайдера → env (`OPENROUTER_API_KEY` для `openrouter`, `ALEM_API_KEY` для `alem`). Автоматического переключения на другого провайдера при ошибке нет.

**Приватность.** Поля OpenRouter (`provider.data_collection: deny`, `zdr`, `usage.include`, `require_parameters`) отправляются только в OpenRouter. Для других провайдеров режим приватности определяется договором с провайдером (`ai_providers.privacy_note`); правила фенсинга недоверенных данных и PII не меняются.

**Учёт.** `ai_usage_ledger.provider_key` и `agent_runs.provider_key` (у запуска — провайдер последнего вызова). Стоимость: `usage.cost` провайдера (`provider`) → цены модели (`model_price`) → консервативная оценка по уровню (`estimate`). Сводка расходов по провайдеру / модели / функции / компании — `spendSummary()`.

**Статус проверки форматов** (без сети в CI; всё покрыто тестами с подменённым fetch):

| Возможность | Alem Plus | Статус |
|---|---|---|
| chat | `POST https://llm.alem.ai/v1/chat/completions`, `Authorization: Bearer <ключ>`, `{"model":"alemllm","messages":[…]}` | **проверено** по спецификации владельца; засеяно (`alem` / `alemllm`) |
| embeddings | стандартный OpenAI `/embeddings` `{model, input}` | путь и модель — данные, **не проверено** вживую |
| rerank | предположение Cohere/Jina: `{model, query, documents, top_n}` → `results[].relevance_score` (адаптер `rerankAdapter`) | **не проверено** |
| OCR | предположение: chat с частью `image_url` (`ocr_mode = chat_vision`) | **не проверено** |
| Qwen 3 | отдельный ключ, id модели неизвестен | добавляется как модель chat с собственным ключом |

`verifyCredential` делает минимальный реальный вызов (chat с `max_tokens: 1`, embedding одной строки или `GET /models`) и сохраняет результат — так владелец проверяет каждый ключ и путь вживую. Ограничение: вызовы с жёстко заданным id модели OpenRouter (`OPENROUTER_MODELS.*`) остаются на OpenRouter, пока такая модель не зарегистрирована у другого провайдера; размерность эмбеддингов другого провайдера должна совпадать с `vector(1536)`.

