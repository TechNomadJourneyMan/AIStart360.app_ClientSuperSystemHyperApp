# 01 — Карта архитектуры: как есть и как будет

Назначение: показать реальные потоки данных сегодня (по коду) и целевую архитектуру по решениям D0–D9.
Обновлено: 2026-10-06

Связанные: [03-database.md](03-database.md), [04-point-a.md](04-point-a.md), [05-agents.md](05-agents.md), [07-admin-control-center.md](07-admin-control-center.md).

---

## Часть A. Текущая архитектура

### A1. Клиентский путь: регистрация → анкета → диагностика → Точка А

```
 /register ──POST /api/client/register──► profiles (upsert), companies (insert), admin_requests
     │                                    (app/api/client/register/route.ts:55-115)
     ▼
 /client/waiting-room ──poll /api/client/status──► profiles.status = approved?
     ▼
 /client/welcome ──/api/v1/organizations/set-vertical──► profiles.vertical
     ▼
 /client/onboarding  (12 шагов: О компании, Цели, Позиционирование, Орг.структура, База,
     │                CJM, Маркетинг, Метрики, Финансы, Личные, Карта влияния, Системы)
     │  автосейв 2.5 c ──POST /api/v1/onboarding/survey──► survey_answers (upsert user_id,question_key)
     │                                                    ├─ trigger → survey_answer_history
     │                                                    ├─ шаг 1 → companies (+target_revenue_*)
     │                                                    └─ side-effects: notifyAdmins, trackEvent, Google Sheets
     ▼  (только при финише / раннем выходе / кнопке «Пересчитать»)
 POST /api/v1/diagnostics/recalculate
     │  calculatePointA(answers)  ← v1, только анкета (lib/point-a-engine.ts:544-579)
     ▼
 diagnostics (новая версия, is_current) ──x-internal-token──► /api/v1/diagnostics/ai-analyze
     │                                                        analyzePointA: 4 вызова OpenRouter
     │                                                        → diagnostics.ai_analysis
     │                                                        → Point B bridge
     ▼
 ┌───────────────────────────────┐      ┌──────────────────────────────────────────┐
 │ /client/point-a  (не в меню)  │      │ /point-a  (меню «Точка А»)                │
 │ gauge /10, 5 блоков, AI-анализ│      │ нет общего балла; KeyMetricsHero (пусто); │
 │ риски, quick wins, roadmap    │      │ MetricZonesGrid; v2 Intelligence;         │
 │ дата = сегодня (не calc date) │      │ v3 Retention/RFM/Loss map; блоки /100      │
 └───────────────────────────────┘      └──────────────────────────────────────────┘
```

Факты: балл не учитывает документы, GRI, метрики, CRM (`02` аудит §4). Сохранение шага анкеты не пересчитывает ни балл, ни метрики.

### A2. Документы

```
 6 клиентских путей загрузки (бакеты: client-documents [приватный, RLS 015],
 documents / user-documents [getPublicUrl → вероятно публичные], reports) + локальный диск (Reports Hub)
     │
     │ A: /client/onboarding/documents (client-documents, signed URL на 1 год)
     │ B: FileArea  C: Header  D: QuickToolbar (без doc_type → 400, сирота)  E/F: поля анкеты
     ▼
 POST /api/v1/onboarding/documents ── documents(parse_status='queued')
     │                              └─ inngest.send('document/parse') ──► (нет подписчика: триггер не зарегистрирован)
     │
     └─ только путь A: POST /api/v1/onboarding/documents/[id]/process  (inline, maxDuration 300)
            fetch(file_url) без таймаута и лимита размера
            parse: PDF текст / DOCX / XLSX / CSV  (PPTX, DOC, изображения → ошибка; OCR не вызывается)
            extract: Sonnet 4.5, вход ≤30 000 символов, maxTokens 4000; fallback regex (0.55)
            rows:    Sonnet 4.5, maxTokens 8000 (без untrusted-обёртки)
            ▼
         documents.parsed_data {summary, fields[], raw_text_preview(2500), model_used}, status 'parsed'
            └─ embeddings: void-промис, флаг ENABLE_DOCUMENT_EMBEDDINGS + Prisma Client(managerId) → не выполняется
```

Пути B/C висят в `queued` навсегда. Застрявший `processing` не сбрасывается (нет reaper).

### A3. Метрики

```
 lib/metrics/descriptions.ts ──► registry.ts  (126 метрик: biz 48 / kpi 12 / gri 7 / goal 59)
                                       │
 survey_answers ─┐                     ▼
 documents       ├─► gatherResolverContext ─► resolveAllMetrics
 (parsed)        ┘   (materialize.ts:35-83)    приоритет manual 100 > document 80 > survey 70 > prisma 60 > external 40
                                               (manual / prisma / external никто не передаёт)
                                                      ▼
                     public.metrics  upsert по 7 колонкам NULLS NOT DISTINCT (080) → история перезаписывается
                                                      ▼
   /api/v1/metrics/catalog (реально) · /api/v1/metrics (всегда []) · /[id]/timeseries|forecast|anomalies (≈1 точка)
 Запуск материализации: POST /api/v1/metrics/materialize, POST /api/v1/point-a/aggregate (кнопка Intelligence)
```

### A4. GRI

```
 /gri → GriPageShell ─ Диагностика ─► GRIAssessment (7 разделов, 67 критериев, 1–10)
                     │                 └─► /api/v1/gri/assessment → gri_assessments (версии, is_current, TOP-5, план 90д)
                     ├ Калькулятор ─► gri_calc_sessions
                     ├ Динамика   ─► gri_pulse_responses (виджет на /pulse)
                     └ AI-аналитик ─► /api/gri/{ai-strategy,financial-analyst}  (без сохранения; DEFAULT_SCORES при прямом заходе)
 gri_assessments → overlay на gri.* в каталоге метрик, радар, Reality Check, NBA.  НЕ влияет на балл Точки А.
 /gri-free (публичный mini-GRI) → mini_gri_leads (не связывается с пользователем после регистрации)
```

### A5. Вызовы LLM (все через OpenRouter)

| Транспорт | Где | Что теряется |
|---|---|---|
| `chatWithOpenRouter` | `lib/ai/openrouter.ts:127-200` | `usage`/стоимость, request id; ретраев нет |
| `generateObjectViaOpenRouter` | `lib/ai/structured.ts:55-140` | 2 попытки с обратной связью; Zod |
| raw `fetch` | `app/api/pulse/route.ts:384`, `pulse/briefing/route.ts:96` | обходит хелперы; `google/gemini-2.0-flash-001` |

≈18 точек вызова: извлечение документов (Sonnet), анализ Точки А (Sonnet×2 + Haiku×2), Точка B, narrative, инсайты, анализ рынка, ассистент «Гри» (4 места), Journey (`openai/gpt-4o`), omnichannel-ответы (`anthropic/claude-opus-4.8`), GRI AI-аналитик, pulse-брифинги, эмбеддинги (`openai/text-embedding-3-small`). Полная таблица — аудит `03` §4. Tool calling не используется нигде.

### A6. Фоновое выполнение

```
 Inngest (lib/inngest.ts, /api/inngest)          Vercel Workflow ('use workflow')        Vercel cron (vercel.json)
 ├ process-omnichannel-message   ✅               ├ process-omnichannel-message           ├ /api/cron/crm-digest      04:00
 ├ backfill-omnichannel          ✅               ├ process-myhonor-order-notification    └ /api/telegram/personal/sync 05:00
 ├ omnichannel-outbound-...-maint ✅ */5          ├ backfill-instagram-history
 ├ omnichannel-maintenance       ✅ 04:15 Almaty  └ backfill-whatsapp-history            runInBackground (waitUntil)
 ├ parse-document                ✗ нет триггера                                            inline-запросы до 300 c
 ├ calculate-gri                 ✗ нет триггера, тело всегда throw
 └ assistant-events-retention    ✗ нет триггера (ретенция 90 дней не работает)
```

Выбор бэкенда omnichannel: `OMNICHANNEL_PROCESSING_BACKEND` = database | workflow | inngest. Единой шины событий нет: `user_events`, `admin_audit_log`, `activity_log` — только приёмники.

### A7. Админ-поверхности

```
 GIGA-CRM  /admin-giga-panel + /api/giga-admin (71)   ← КАНОНИЧЕСКАЯ (requireGiga, RBAC 7×32, аудит)
   └ SuperExpert /super-expert  — урезанное представление тех же компонентов
 Legacy: /api/v1/admin 5 (используется /clients); /team — Prisma
         (W1 удалил /admin, /admin/requests, /api/admin 16, /owner/**, (dashboard)/users;
          middleware ведёт старые адреса в GIGA / кабинет; роль owner = клиент)
 Expert:  /expert/** + /api/expert/* (эксперты — сотрудники, видят всех клиентов)
 /giga-login — только ссылка на личный /login?from=/admin-giga-panel (break-glass удалён в W1)
```

### A8. Уведомления

```
 доменный маршрут ─► notifyAdmins(type,data)  ─► email (ADMIN_NOTIFICATION_EMAIL)
                    (lib/notifications.ts:397)  └► Telegram sendMessage → TELEGRAM_ADMIN_CHAT_IDS (env)
                    дедуп 60 c в памяти, без уровня, без журнала, ошибки только в лог
                 ─► notifyUser ─► email / profiles.telegram_chat_id
                 ─► createNotification ─► app_notifications (лента пользователя; у персонала ленты нет)
 Эскалации ассистента: EscalationDispatcher → internal / telegram / email / whatsapp (allSettled)
 Telegram webhook /api/telegram/webhook: только /start <code>; секрет опционален (fail-open)
 Telegram userbot (MTProto): раз в сутки читает ЛС и отвечает
```

---

## Часть B. Целевая архитектура

### B1. Общая схема

```
  Клиент (Next UI)        GIGA-CRM «ИИ-агенты»         Telegram (staff)          внешние SaaS
        │                        │                          │ callback_query          │ (опц.) n8n
        ▼                        ▼                          ▼                         ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ Next.js API (Vercel)                                                                     │
 │  authz: Supabase session + can_read_company/can_manage_company · requireGiga(perm)       │
 │  /api/telegram/webhook (секрет обязателен, HMAC callback) · /api/integrations/inbound    │
 │  доменные сервисы ── emitPlatformEvent(name, company_id, subject, payload) ─────────────┐ │
 └─────────────────────────────────────────────────────────────────────────────────────────│─┘
          │ service role (после authz)                                                    │
          ▼                                                                               ▼
 ┌────────────────────── Supabase Postgres (источник истины) ─────────────────────────────────┐
 │ tenancy: companies, company_members, partner_organizations, partner_members (084)          │
 │ diagnostics: diagnostic_sessions, diagnostic_findings, diagnostic_recommendations,         │
 │              metric_value_history, metric_targets, report_versions (085)                    │
 │ agents: agent_configs, agent_permission_grants, agent_tasks, agent_runs, agent_tool_calls, │
 │         agent_approvals, agent_events, platform_events (086)                               │
 │ notify: notification_events, notification_deliveries, staff_telegram_links (087)          │
 │ files:  documents (+storage_path, sha256, security_status, processing_stage…) (088)        │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
          ▲                         ▲ claim/lease/complete                   │ outbox
          │                         │                                         ▼
 ┌────────┴─────────────────────────┴──────────┐        ┌──────────────────────────────────────┐
 │ Agent runtime (lib/agents/*)                │◄───────│ Inngest                              │
 │  registry (definitions = код, PR-ревью)     │        │  agents/task.requested → run task    │
 │  permission engine (grants + потолки)       │        │  cron * * * * * → drain + reap leases│
 │  budget guard (run/agent/company/platform)  │        │  platform events → enqueue подписчиков│
 │  tool registry (JSON Schema, MCP-совм.,     │        └──────────────────────────────────────┘
 │   привязан к company_id задачи)             │        fallback: Vercel cron /api/cron/agents
 │  runner: claim → run → record → done/retry/dead      (CRON_SECRET только в заголовке)
 │  LLM gateway lib/ai/gateway.ts ──► OpenRouter (light/standard/premium; usage.cost)
 │                               └─► Langfuse (опц., при наличии ключей)
 └─────────────────────────────────────────────┘
          │ APPROVAL_REQUESTED, AGENT_FAILED, CRITICAL_RISK_FOUND …
          ▼
 notification_events ─► routing (уровень × канал, тихие часы, дедуп) ─► notification_deliveries
                                                                         ├ telegram (карточка + кнопки)
                                                                         ├ email (Resend)
                                                                         └ in_app
 Vercel Workflow — остаётся для omnichannel (не для агентов).
 MCP — read-only сервер для админов: оценить в Phase 7. Внешние MCP — только allowlist + креды тенанта, позже.
```

### B2. Поток диагностики (целевой)

```
 ONBOARDING_COMPLETED / QUESTIONNAIRE_COMPLETED / FILE_PROCESSED / ручной запуск
      ▼
 diagnostic_orchestrator (детерминированный) ─ создаёт diagnostic_sessions(status=collecting)
      ├─► data_collection  → снимок анкеты/компании/GRI/CRM + completeness
      ├─► document_intelligence (на каждый FILE_UPLOADED) → parsed_data + этапы
      ├─► data_quality     → находки kind=data_gap|anomaly
      ├─► metrics          → materialize + metric_value_history (METRIC_UPDATED)
      ├─► benchmark        → сравнение с бенчмарками из кода (с меткой источника)
      ├─► diagnostic       → правила (CALCULATED) + LLM-гипотезы (AI_HYPOTHESIS, скрыты до ревью)
      ├─► recommendation   → diagnostic_recommendations (RECOMMENDATION)
      └─► report           → report_versions (снимок + provenance; premium-нарратив опц.)
      ▼
 diagnostic_sessions(status=ready, overview = снимок Executive Overview) → DIAGNOSTIC_COMPLETED
```

### B3. Таблица ответственности

| Компонент | Отвечает за | Не отвечает за | Источник истины |
|---|---|---|---|
| Next.js API | Аутентификация, авторизация, валидация (zod), запись через service role после authz, `emitPlatformEvent` | Длительные вычисления, ретраи LLM | — |
| Supabase Postgres | Состояние: тенанты, данные клиента, очередь задач, запуски, одобрения, события, уведомления; RLS только на чтение для клиентов | Бизнес-логику агентов | Да, для всего |
| Определения агентов (`lib/agents/definitions/*.ts`) | key, описание, tier, инструменты, права по умолчанию, промпт + `prompt_version`, триггеры, лимиты | Рантайм-настройки | Код (ревью через PR) |
| `agent_configs` / `agent_permission_grants` | Вкл/выкл, override модели/tier, расписание, бюджеты, ужесточение прав | Ослабление прав выше потолка в коде | БД (админ GIGA) |
| Agent runtime (`lib/agents/*`) | claim/lease, проверка прав и бюджета, вызов инструментов, запись run/tool_calls/events, retry/backoff/dead | Транспорт событий | `agent_tasks`, `agent_runs` |
| LLM gateway (`lib/ai/gateway.ts`) | tier→модель, вызов OpenRouter, `usage`+`cost`, бюджет-чек, редакция логов, опц. Langfuse | Выбор инструментов | `agent_runs.tokens_*`, `cost_usd` |
| Tool registry | JSON Schema инструмента (MCP-совместимая), право, обработчик, привязанный к `company_id` задачи | Доступ к другому тенанту (невозможен по конструкции) | Код |
| Inngest | Доставка событий, триггер задач, cron drain + reaper | Хранение статуса (только сигнал) | Нет (статус в БД) |
| Vercel cron `/api/cron/agents` | Fallback-drain, если Inngest не настроен | — | — |
| Vercel Workflow | Omnichannel и MyHonor (как сейчас) | Агенты | — |
| n8n (опционально) | Long-tail SaaS-коннекторы → подписанный вебхук → `platform_events` | Бизнес-логику, решения, доступ к БД | — |
| MCP | Схемы инструментов совместимы; read-only сервер для админов — оценка в Phase 7 | Запись данных | — |
| GIGA-CRM «ИИ-агенты» | Наблюдение, настройка, ручной запуск, одобрения, бюджеты; все мутации `requireGiga` + `recordAdminAction` | Редактирование промптов (только через код) | — |
| Telegram-бот | Доставка уведомлений по уровням; Approve/Reject для привязанных сотрудников с `approvals.decide` | Любые иные команды изменения данных | `staff_telegram_links`, `agent_approvals` |
| Клиентский UI | Executive Overview, «Метрики», реальные статусы файлов; видит только находки `visible_to_client` | AI-гипотезы до ревью | — |
| Supabase Storage | Один приватный бакет, путь `<owner>/...`, короткие signed URL | Публичные ссылки на клиентские файлы | `documents.storage_path` |

### B4. Что убирается или замораживается

| Что | Действие | Фаза |
|---|---|---|
| Inngest `calculate-gri`, `parse-document` (старый) | удалить / заменить агентом `document_intelligence` | 6, 8 |
| `assistant-events-retention` | исправить на `triggers:[{cron}]` | 6 |
| `/admin`, `/owner/admin`, `/api/admin/*`, `/api/v1/admin/*`, `(dashboard)/users` | вывести из эксплуатации, редирект в GIGA | 13 |
| NextAuth (`app/api/auth/[...nextauth]`, 8 маршрутов на `lib/api-utils.ts`) | удалить | 13 |
| Prisma `organizations`, `notifications`, `crm_integrations`, `diagnostic_runs`, `financial_snapshots`, `pulse_metrics`, `audit_logs` (после конца dual-write) | заморозить (RLS ON с 083), удалить после отказа кода | 13 |
