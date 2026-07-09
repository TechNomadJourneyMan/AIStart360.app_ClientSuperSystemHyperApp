# 10 · Часть L (UX-рамка) · Часть M (Backend, БД) · API-справочник (T20–T23)

## 1. UX/UI сквозные требования (Часть L)

Per-feature флоу описаны в файлах 01–09. Сквозные правила для всех новых экранов:

- **Состояния обязательны:** empty (CTA к источнику данных) / loading (skeleton, маскот `loading`)
  / error (честная ошибка + retry, никогда фейк-данные — принцип уже в кодовой базе) / rate-limited.
- **Объяснение AI-решений:** у каждого AI-вывода — «почему» (grounding-chips A1, reason NBA,
  допущения симулятора). Пользователь всегда может спросить «Объясни с ГРИ».
- **Прозрачность AI:** бейджи провенанса (AI-черновик / подтверждено — паттерн `market_analysis_answers`
  распространяется на все AI-артефакты).
- **Психологизация без пугания:** только бизнес-язык, само-описание, подтверждение гипотез
  пользователем, «стиль», не «тип личности» (файл 07).
- **Управление:** отключить персонализацию (1 переключатель), сменить/сбросить агента (1 кнопка),
  сбросить психопрофиль, удалить диалоги. Всё — в настройках ассистента (существующая панель).
- **Mobile:** все новые экраны — mobile-first (аудитория СНГ-предпринимателей мобильная);
  инпуты ≥16px (iOS-zoom finding из аудита 2026-07-07); чат-панель — bottom-sheet на мобильных.
- **A11y:** фокус-порядок в чатах и мастерах, aria-live для стриминга/тостов, контраст на тёмной теме,
  dnd с клавиатурной альтернативой (паттерн WidgetGrid уже есть).
- **Сохранение прогресса:** мастера (симулятор, психопрофиль, intake) переживают перезагрузку
  (localStorage + сервер, паттерн онбординга).
- **Тон микрокопии:** no-shame, конкретика, 0 обещаний. Дисклеймеры — короткие и постоянные,
  не «стены текста».

## 2. Backend-архитектура (Часть M)

```
┌─ app/api/v1/* (route handlers) ──────────────────────────────────────────┐
│ auth: Supabase-сессия (getUser) · Zod-вход · rate-limit (Upstash)        │
├──────────────────────────────────────────────────────────────────────────┤
│ Services (lib/*)                                                          │
│  lib/ai/orchestration ── единая точка LLM-вызовов:                        │
│    buildContext → retrieve → generate (personas) → validate → log        │
│  lib/nba · lib/psych · lib/simulator · lib/paywall · lib/digest          │
│  lib/gri/trust · lib/benchmarks · lib/registration/risk                  │
├──────────────────────────────────────────────────────────────────────────┤
│ Data: Supabase Postgres (RLS) + Prisma (billing/admin) — существующее    │
│ разделение сохраняется; новые пользовательские таблицы — Supabase+RLS    │
│ Jobs: Inngest (retention, digest-generate) + Vercel cron [DEP]           │
│ Observability: Langfuse (LLM) + assistant_events (телеметрия)            │
│ Feature flags: env (паттерн проекта) — NEXT_PUBLIC_FEATURE_* / SERVER_*  │
└──────────────────────────────────────────────────────────────────────────┘
```

Принципы: (1) один вход для LLM — `lib/ai/orchestration.ts` (микс промптов, validator, логи —
никто не зовёт `chatWithOpenRouter` напрямую из роутов; мигрируем и pulse-роуты, Q5);
(2) деградация без фабрикации; (3) RLS-first: новые таблицы self-scoped, staff-доступ — только
после Q4; (4) миграции — plain SQL 045+ через `apply-migration.js`; (5) rollback каждой фичи —
env-флаг, не revert-миграция.

## 3. Сущности Части M → маппинг на схему

| Сущность ТЗ | Реализация | Статус |
|---|---|---|
| UserProfile | `profiles` (Supabase) + `preferences.assistant` JSONB | есть |
| FounderPsychProfile | `founder_psych_profiles` (047) | новая |
| GRIAgentPersona | код `lib/ai/personas/registry.ts` (не БД) | новая |
| GRIPersonaSelection | `profiles.preferences.assistant.personaId` + `ai_conversations.persona_id` | новая (поля) |
| AIConversation / AIMessage | `ai_conversations` / `ai_messages` (045) | новые |
| AIValidationResult | `ai_messages.validation` JSONB (+ Langfuse полн.) | новая (поле) |
| BusinessSimulation | `business_simulations` (052) | новая |
| SimulationScenario/Input/Output | внутри `inputs`/`result` JSONB (нормализация не нужна на этом масштабе) | новые (JSONB) |
| UserConsent | `user_consents` (047) | новая |
| PersonalizationMemory | отложено до AI-3 (файл 06 §3) | later |
| UploadedBusinessFile | `document_summaries`/`documents`+Storage | есть |
| AuditLog | Prisma `AuditLog` (`lib/audit.ts`) | есть |
| NextBestAction | compute-on-read + `nba_log` (048) | новая |
| ActionPlan90Day / ActionPlanTask | `gri_assessments.action_plan_90d` + `action_items` (030+049) | есть+расширение |
| PulseSnapshot | `gri_pulse_responses` (027) | есть |
| GRITrustSignal | on-the-fly (`lib/gri/trust.ts`), опц. 050 | новая (код) |
| BenchmarkDataset / BenchmarkResult | код `lib/benchmarks/dataset.ts`; живая база — `benchmark_contributions`/`rollups` (later) | есть+v2 |
| MarketSource | `market_analysis_answers.citations` JSONB | новая (поле) |
| ReportSlice | `report_slices` (053) | новая |
| ExpertReview | `expert_reviews` (053) | новая |
| CRMLead | `crm_clients` (044) `[DEP]` + `mini_gri_leads` (033) | есть (ветка) |
| GRICreditAccount / Transaction | `gri_credit_accounts`/`gri_credit_transactions` (при старте G2) | later |
| PaywallEvent / UnlockEvent | `paywall_events` (054) / `assistant_events` тип `unlock` | новые |

### Детализация новых таблиц: privacy / retention

| Таблица | Privacy level | Retention | Индексы (ключевые) |
|---|---|---|---|
| `ai_conversations`/`ai_messages` | high (содержимое диалогов) | 180 дней (Inngest), cascade при удалении аккаунта | (user_id,surface,updated_at), (conversation_id,created_at) |
| `founder_psych_profiles` | **highest** — только self, не staff | до сброса пользователем; удаление = полное | user_id unique |
| `user_consents` | medium | бессрочно (юридический след), revoked_at вместо delete | (user_id,kind) |
| `nba_log` | medium | 180 дней | (user_id,action_key,created_at) |
| `business_simulations` | high | до удаления пользователем; cap 20 | (user_id,updated_at) |
| `report_slices` | high (investor-данные) | до удаления; связка с shared_reports revoke | (user_id,slice_type) |
| `expert_reviews` | high | 2 года | (user_id), (expert_id,status) |
| `paywall_events` | low (нет ПДн кроме user_id) | 400 дней (аналитика) | (feature,event,created_at) |
| `gri_credit_*` | medium | бессрочно (финансовый след) | (account_id,created_at) |
| `benchmark_contributions` | **anonymous by design** | бессрочно | (industry,stage) |

## 4. API-справочник (сводный; детали в файлах фич)

Все: Supabase-сессия, Zod, rate-limit per-user, envelope `{data}|{error}` по паттерну проекта.

```
AI-чат:        POST/GET  /api/v1/ai/chat · GET/DELETE /api/v1/ai/chat/[id] · POST .../feedback
NBA:           GET       /api/v1/nba · POST /api/v1/nba/event
План 90д:      GET       /api/v1/action-plan · PATCH .../tasks/[id] · POST .../tasks ·
               POST      .../tasks/[id]/replace
Психопрофиль:  GET/POST  /api/v1/psych-profile · POST .../mechanics/[mid] · DELETE /api/v1/psych-profile
Симулятор:     GET/POST  /api/v1/simulator · POST .../[id]/run · PATCH/DELETE .../[id] ·
               POST      .../[id]/to-point-b · POST .../[id]/to-plan
Trust:         GET       /api/v1/gri/trust (data-confidence для виджета)
Бенчмарки:     GET       /api/v1/benchmarks?industry=&stage= (rows+ограничения)
Дайджест:      POST      /api/v1/digest/preview (для настроек) · unsubscribe GET /api/digest/unsub?t=
Согласия:      GET/PUT   /api/v1/consents
Персоны:       GET       /api/v1/assistant/personas · settings PUT (personaId) — расширение
OG:            GET       /api/og/gri?token=
Симулятор PDF: GET       /api/v1/simulator/[id]/pdf
Slices:        POST/GET  /api/v1/report-slices · GET .../[id]/pdf
Expert review: POST/GET  /api/v1/expert-reviews · PATCH /api/expert/reviews/[id] (эксперт) ·
               PATCH     /api/admin/expert-reviews/[id]/assign (админ)
Кредиты (G2):  GET       /api/v1/agency/credits · POST .../spend
Регистрация:   (изменение) POST /api/auth/register — ветка auto · giga settings PUT mode='auto'
```

Rate-limits (предложение): chat 10/мин; simulator run 4/мин; psych mechanics 20/мин;
nba GET 30/мин; остальное 15/мин. Дневной AI-бюджет: 100 сообщений чата, 10 прогонов симулятора
(paywall-переопределяемо).

## 5. Error handling / fallback (сквозная политика)

| Сбой | Поведение |
|---|---|
| OpenRouter timeout/5xx | 1 retry (structured), затем: чат → честная ошибка; NBA/дайджест/ставки → детерминированный шаблон; симулятор → результат ядра без narrative |
| Validator LLM недоступен | risk<medium → deterministic-only + пометка; иначе шаблон Т2 |
| Upstash недоступен | rate-limit in-memory fallback (есть); paywall fail-open |
| Retrieval пуст/упал | ответ без документов + честная пометка |
| Новая таблица не мигрирована | degrade-to-200 паттерн checkout: фича скрывается, ядро живёт |

## 6. Feature flags и rollback

```
SERVER: ENABLE_DOCUMENT_EMBEDDINGS (есть, включить) · AI_CHAT_ENABLED · AI_VALIDATOR_MODE
        (off|deterministic|full) · SIMULATOR_ENABLED · PAYWALL_ENFORCE · DIGEST_ENABLED ·
        REGISTRATION_AUTO (дублирует giga-настройку как kill-switch)
CLIENT: NEXT_PUBLIC_FEATURE_MASCOT (есть) · NEXT_PUBLIC_FEATURE_PERSONAS · NEXT_PUBLIC_FEATURE_PSYCH ·
        NEXT_PUBLIC_FEATURE_SIMULATOR · NEXT_PUBLIC_FEATURE_NBA
```

Rollback любой фичи = выключить флаг (UI и роуты прячутся, таблицы остаются — данные не теряем).
Миграции пишутся идемпотентно (`IF NOT EXISTS`), вниз-миграций не делаем (паттерн проекта).
