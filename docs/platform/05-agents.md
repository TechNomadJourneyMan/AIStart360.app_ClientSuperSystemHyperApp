# 05 — Мультиагентная архитектура

Назначение: полное описание агентного слоя по решению D3 (+ D4, D7): агенты, права, жизненный цикл, события, безопасность, наблюдаемость, стоимость.
Обновлено: 2026-10-06

Статус: ⬜ план (миграция 086, Phase 7 и 9). Сейчас агентов нет; tool calling не используется нигде (аудит 03 §4).
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
| `report` | Снимок `report_versions` + опц. premium-нарратив; PDF | `DIAGNOSTIC_COMPLETED`, ручной | `report.create_version`, `report.render_pdf`, `llm.narrative` | READ_CLIENT_DATA, CREATE_REPORT, CALL_LLM | premium (опц.) | $1.00 | `report_versions` (draft/ready), `REPORT_GENERATED`. Публикует клиенту только человек |
| `monitoring` | Зависшие/мёртвые задачи, расход бюджета, сбои интеграций и вебхуков, зависшие документы | cron `*/15`, `AGENT_FAILED`, `INTEGRATION_FAILED` | `health.read`, `notify.staff` | READ_CLIENT_DATA (агрегаты), SEND_TELEGRAM (только персоналу) | — | $0 | `notification_events` WARNING/CRITICAL |
| `admin_assistant` (позже) | Q&A по статистике платформы для персонала, только чтение | ручной (GIGA) | `stats.read` | READ_CLIENT_DATA (агрегаты), CALL_LLM | light | $0.05 | ответ |

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
| WRITE_CLIENT_DATA | ALLOW | Служебные поля (сессия, статусы). Ответы анкеты клиента не меняются |
| READ_FILES | ALLOW | Файлы компании задачи |
| PROCESS_FILES | ALLOW | Только `parsed_data`, `processing_stage`, `security_*` |
| CALL_LLM | ALLOW | Только через gateway, под бюджетом |
| UPDATE_METRICS | ALLOW | `source ∈ {document, calculated, resolver, external}`; `manual` — нельзя |
| CREATE_FINDINGS | ALLOW | AI_HYPOTHESIS всегда `visible_to_client=false` |
| CREATE_REPORT | ALLOW | Статусы draft/ready; `published` — только человек |
| RUN_INTEGRATION | ALLOW (чтение) | Запись во внешнюю систему → REQUIRE_APPROVAL |
| SEND_TELEGRAM | ALLOW только `audience=staff` | Клиенту → REQUIRE_APPROVAL |
| SEND_EMAIL | REQUIRE_APPROVAL | «EXTERNAL_COMMUNICATION» из D3 |
| EXECUTE_WORKFLOW | ALLOW | Только агенты из `children[]` определения |
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
| `REPORT_GENERATED` | report | — | APPROVAL_REQUIRED (публикация) |
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
| Компания / день | `system_settings` | $5 | Задачи компании ждут; WARNING |
| Платформа / день | `system_settings` | $50 | Все LLM-задачи ждут; CRITICAL |

Текущие вызовы вне агентов (омниканал на Opus 4.8, Journey на GPT-4o, pulse на Gemini через raw fetch) переводятся на gateway в Phase 7, чтобы учёт был полным.
