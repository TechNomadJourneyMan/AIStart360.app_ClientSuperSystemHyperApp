# 03 — База данных: текущая модель, drift, план миграций 083–088

Назначение: описать модель данных как она есть, расхождения репо и прода, и точный план новых таблиц по решениям D1–D6.
Обновлено: 2026-10-06

Обозначения: `NNN:LL` = `supabase/migrations/NNN_*.sql`, строка LL. Svc-only = RLS ON без политик (+ REVOKE), доступ только service role.
Связанные: [09-security.md](09-security.md), [05-agents.md](05-agents.md), [04-point-a.md](04-point-a.md).

## 1. Текущая модель

### 1.1 Кто владеет DDL

| | Prisma | Supabase SQL |
|---|---|---|
| Источник | `prisma/schema.prisma` (26 моделей) | `supabase/migrations/*.sql` (86 файлов до 083, 74 `CREATE TABLE`) |
| Инструмент | только `prisma generate`; каталога `prisma/migrations/` нет; таблицы созданы из `scripts/init-schema.sql` | `node scripts/apply-migration.js <file>` — один файл = одна неявная транзакция |
| Леджер | нет | **нет до 083**; с 083 — `public.schema_migrations(file, checksum, applied_at, applied_by)`, скрипт пишет в него |
| Правило | Новые Prisma-модели — только если Prisma-коду нужен типизированный доступ, DDL всё равно в SQL (как 033) | Весь новый DDL — здесь. TEXT + CHECK вместо enum. **Никогда** `prisma db push` / `migrate dev` против этой БД (≈70 SB-таблиц и 10 колонок `companies` будут «drift») |

`companies` — одна физическая таблица для Prisma `Company` и Supabase (013:1-9), PK **TEXT**.

### 1.2 Идентичность и тенантность (сейчас)

| Элемент | Факт |
|---|---|
| Идентичность | `auth.users` → `profiles` (1:1, триггер `handle_new_user`). Prisma `users` — NextAuth legacy |
| Тенант | auth-пользователь. Все SB-таблицы, кроме `metrics`, скоупятся `user_id = auth.uid()`. `companies` 1:1 с пользователем (013:21-23) |
| Организации | Нет. `profiles.organization` — свободный текст; Prisma `organizations` только для legacy CRM |
| «Клиент» | 4 значения: `profiles(role=client)`+`companies`; Prisma `clients`; `crm_clients`; `omnichannel_contacts` |
| Роли | `profiles.role` (7 значений, 001:27); `staff_roles` (7 ролей GIGA, 073/081); Prisma `UserRole` |
| Персонал в RLS | Staff(A) = super_admin, admin, manager, analyst — чтение ядра; expert — глобальное чтение инсайтов/кейсов и **запись** `action_items`, `point_b_versions`; `staff_roles` в RLS не участвует |
| `company_id` | Смешанные типы: TEXT FK (021, 024, 032), UUID без FK (027, 053, 058), UUID FK из 001 (`survey_answers`, `documents`, `metrics`, `diagnostics`) — тип в проде не подтверждён |

### 1.3 Таблицы по доменам (≈95: 74 SQL + 21 только Prisma)

| Домен | Таблицы |
|---|---|
| Идентичность, персонал | `profiles`, `companies`, `staff_roles`, `user_assignments`, `impersonation_sessions`, `user_security`, `webauthn_credentials`, `system_settings`, `platform_invitations`; Prisma: `organizations`, `users`, `accounts`, `sessions`, `verification_tokens`, `subscriptions`, `payment_transactions` |
| Анкеты, тесты | `survey_answers`, `survey_answer_history`, `market_analysis_answers`, `market_snapshots`, `gri_assessments`, `gri_assessment_drafts`, `gri_pulse_responses`, `gri_calc_sessions`, `gri_plan_progress`, `founder_psych_profiles`, `user_consents`; Prisma: `mini_gri_leads`, `gri_reports` |
| Диагностика, AI | `diagnostics`, `point_a_insights`, `point_b_analysis`, `point_b_versions`, `action_items`, `expert_cases`, `assistant_runs`, `assistant_events`, `expert_comments`, `ai_conversations`, `ai_messages`, `nba_log`, `business_simulations`, `patient_segments`, `growth_bundles`, `revenue_losses`, `ai_journey_*` (5); Prisma: `diagnostic_runs` (не используется), `document_summaries`, `document_chunks` |
| Файлы, метрики | `documents`, `storage.objects` (`client-documents`), `metrics`; Prisma: `financial_snapshots`, `pulse_metrics`, `reports`, `report_documents` (без DDL), `projects`, `clients`, `admin_requests`, `comments` |
| CRM, аудит, уведомления | `crm_clients`, `crm_interactions`, `crm_reminders`, `crm_provider_connections`, `user_notes`, `staff_tasks`, `user_events`, `admin_audit_log` (append-only), `activity_log`, `app_notifications`, `email_deliveries`, `myhonor_order_notifications`, `telegram_personal_*`; Prisma: `crm_integrations` (без DDL), `audit_logs`, `activity_logs`, `notifications` |
| CMS, omnichannel | `cms_pages`, `cms_blocks`, `cms_page_revisions`, `platform_sections`, `dashboard_layouts`, `omnichannel_*` (8, без тенант-колонки, роль `aistart360_omnichannel_runtime`); Prisma: `shared_reports` |

### 1.4 RLS: до и после 083

| Риск | До 083 | После 083 (код ✅, прод ⛔) |
|---|---|---|
| Signup-триггер | Роль/статус из `raw_user_meta_data` | Роль только из `raw_app_meta_data` (service role); из user metadata — `client`/`owner`, всегда `pending_approval` |
| `profiles_update_own` | Пинит только `role`, `status` | BEFORE UPDATE guard: `role`, `status`, `tier`, `feature_flags`, `approved_at/by` — только service role / super_admin / admin; Telegram — только отвязка |
| 25 Prisma-таблиц | Нет RLS/REVOKE в репо | RLS ON без политик + `REVOKE ALL FROM anon, authenticated` |
| `v_pending_users`, `v_client_diagnostics` | Owner-rights, обходят RLS | `security_invoker = true` + REVOKE |
| `search_path` триггер-функций | Не задан у 5 функций | Задан у `set_updated_at`; остальные 4 — план (Phase 2) |
| Подделка provenance (R5), нет UPDATE на `diagnostics` (R8), глобальный эксперт (R6), `point_b_versions` без `is_approved` (R7) | Открыто | Открыто → 084/085 и Phase 2–3 |

Тесты: `tests/integration/db/security-hardening.test.ts` (S1–S4) через `tests/helpers/pg-rls.ts` — `SET ROLE anon/authenticated` + `request.jwt.claims` в откатываемой транзакции.

## 2. Schema drift

Репозиторий не может воспроизвести прод с нуля. Подтверждено комментариями в миграциях (прод недоступен — B1).

| # | Расхождение | Доказательство | Как учтено |
|---|---|---|---|
| D-1 | `companies.id` = TEXT (Prisma), а 001 объявляет `CREATE TABLE companies (id UUID …)` — в проде no-op | 013:1-9 | drift-правило для 001 |
| D-2 | 001 объявляет UUID-FK на `companies(id)` в `survey_answers` (:116), `documents` (:139), `metrics` (:178), `diagnostics` (:206) — невозможно против TEXT PK | 001; 01-аудит §1.4 | drift-правило: `company_id UUID REFERENCES companies` → TEXT |
| D-3 | `documents.user_id` в проде TEXT | 020:6-9 | новые политики сравнивают через `::text` |
| D-4 | Колонки `parsed_data`/`parse_error`/`n8n_execution_id` «не материализовались» в проде до 017 | 017:2-5 | — |
| D-5 | `point_b_analysis` существовала в проде без миграции | 029:2-5 | — |
| D-6 | `metrics_unique_idx` существовал с другими колонками | 070:9-10, 080:6-8 | 080 выравнивает до 7 колонок |
| D-7 | 077 ссылается на триггер `companies_onboarding_updated_at` «(migration 013)» — его не создаёт ни один файл | 077:9 | фантом; не воспроизводится |
| D-8 | `report_documents`, `crm_integrations` (Prisma) — нет DDL ни в миграциях, ни в `init-schema.sql` | 01-аудит §1.4 | локально создаются из Prisma DDL |
| D-9 | Дубли номеров: 035×2, 036×2, 069×3, 070×3, 071×2, 072×2, 073×2; пропуски 011, 049–052 | `ls supabase/migrations` | порядок = алфавитный; с 084 номера уникальны |
| D-10 | Не перезапускаемы: 001:277-428, 004:12-28, 009:61-68, 010:83-98 (`CREATE POLICY` без `DROP`) | 077:1-6 | применять один раз; леджер с 083 |
| D-11 | Код читает несуществующие колонки: `metrics.value_numeric/value_text`, `diagnostics.created_at`, `companies.employee_count/regions/contact_position` | 01-аудит R11 | исправить код (Phase 2) после сверки с продом |
| D-12 | Не было леджера применённых миграций | `apply-migration.js` | ✅ `schema_migrations` (083) |

### Локальное зеркало: правила `scripts/test-db/setup.mjs`

| Правило | Что делает |
|---|---|
| Только localhost | Отказ при не-локальном хосте `TEST_DB_ADMIN_URL`; имя БД `^[a-z0-9_]+$` |
| Порядок | `supabase-stubs.sql` (роли anon/authenticated/service_role[BYPASSRLS], `auth.users`, `auth.uid()/role()/jwt()`, `storage.*`, публикация realtime) → Prisma DDL (`prisma migrate diff --from-empty`) → все миграции по имени файла, каждая в своей транзакции |
| `DRIFT_RULES['001_onboarding_system.sql']` | UUID-FK → TEXT; `CREATE TABLE companies` → `ALTER TABLE companies ADD COLUMN IF NOT EXISTS …` (модель конечного состояния прода) |
| `SKIP['072_omnichannel_direct_catalog.sql']` | Data-миграция проверяет прод-строки Honor-канала |
| pgvector | Если нет — `vector(N)` → `real[]`, HNSW/IVFFlat-индексы пропускаются |
| Гранты | Только `ALTER DEFAULT PRIVILEGES` из стабов (как Supabase); общий GRANT после миграций убран — он маскировал REVOKE |

Комментарий в `setup.mjs` ссылается на `docs/platform/02-database.md` — актуальный файл этот (`03-database.md`).

## 3. План миграций 083–088

Общий базис (D1) для новых таблиц: `company_id TEXT REFERENCES companies(id)`; RLS ON; `REVOKE INSERT, UPDATE, DELETE FROM anon, authenticated`; запись только service role из API после авторизации; `timestamptz` + `set_updated_at()`; TEXT + CHECK; актор — TEXT (`user:<uuid>` / `agent:<key>` / `giga:super_admin`), как `admin_audit_log.actor_id`.
Чтение: клиентские таблицы — `can_read_company(company_id)`. Для `agent_*` и `notification_*` **предлагается** сузить до `is_platform_staff()` (там непроверенный AI-вывод и данные персонала) — требует подтверждения ведущего.

### 083 — security hardening ✅ код / ⛔ прод
`schema_migrations`; `handle_new_user` (S1); `profiles_guard_privileged_columns` (S2); RLS+REVOKE на 25 Prisma-таблицах (S3); `security_invoker` на 2 view (S4); `search_path` для `set_updated_at`. Подробно — [09](09-security.md).

### 084 — тенантность (D1) 🔄

| Объект | Ключевые колонки | PK / FK | Индексы | RLS | Жизненный цикл / аудит |
|---|---|---|---|---|---|
| `partner_organizations` | `name`, `slug`, `status` active\|suspended, `created_by`, ts | `id uuid` | UNIQUE `slug` | SELECT: staff или активный участник партнёра | Нет удаления — `suspended`; мутации через GIGA → `admin_audit_log` |
| `partner_members` | `partner_id`, `user_id`, `role` partner_admin\|partner_expert, `status` | PK `(partner_id, user_id)`; FK partner CASCADE, `auth.users` CASCADE | `user_id` | SELECT: свои строки; partner_admin — строки своего партнёра; staff | Значения `status` в D1 не заданы — предлагается `invited\|active\|removed` |
| `companies.partner_id` | `uuid NULL` (NULL = прямой клиент) | FK `partner_organizations` ON DELETE SET NULL | `partner_id` | — | Смена партнёра — только GIGA, аудит |
| `company_members` | `company_id TEXT`, `user_id uuid`, `role` owner\|admin\|member\|viewer, `status` invited\|active\|removed, `invited_by`, ts | `id uuid`; UNIQUE `(company_id, user_id)`; FK companies CASCADE, `auth.users` CASCADE | `user_id`, `(company_id, status)` | SELECT: `can_read_company`; запись — service role | Soft delete = `removed`. Backfill: каждый `companies.user_id` → `owner/active`; `companies.user_id` остаётся «основным владельцем» |
| Функции | `is_platform_staff()`; `company_member_role(text)`; `can_read_company(text)`; `can_manage_company(text)` | SECURITY DEFINER, STABLE, `search_path` закреплён | — | EXECUTE для authenticated | `is_platform_staff` = `profiles.role` ∈ {super_admin, admin, manager, analyst, expert} или одобренная строка `staff_roles` |
| Аддитивные SELECT-политики | `companies`, `diagnostics`, `metrics`, `documents`, `survey_answers`, `gri_assessments` → `can_read_company(company_id::text)` | — | индексы на `company_id` там, где их нет (`survey_answers`, `documents` — R14) | Только SELECT; существующие `user_id`-политики не трогаются | Строки с `company_id IS NULL` — по-прежнему только владелец |

### 085 — диагностика и provenance (D2, D5) ⬜

| Объект | Ключевые колонки | PK / FK | Индексы | RLS | Статусы / soft delete / аудит |
|---|---|---|---|---|---|
| `diagnostic_sessions` | `user_id` (инициатор), `kind` point_a\|full\|gri\|refresh, `status`, `trigger`, `diagnostic_id`, `gri_assessment_id`, `overview jsonb` (снимок L1 при финализации), `completeness numeric`, `sources jsonb`, `started_at`, `completed_at`, ts | `id uuid`; FK companies, `diagnostics`, `gri_assessments` | `(company_id, created_at desc)`, `(status)` | `can_read_company` | draft→collecting→processing→ready\|failed; `archived` = soft delete |
| `diagnostic_findings` | `session_id`, `kind` risk\|gap\|bottleneck\|opportunity\|strength\|data_gap\|anomaly, `area` (ключ категории метрик), `title`, `body`, `severity` critical..info, `provenance_type` FACT\|CALCULATED\|INFERRED\|AI_HYPOTHESIS\|RECOMMENDATION, `confidence` 0..1, `evidence jsonb [{type,ref,field,value}]`, `produced_by` (`engine:<x>`/`agent:<key>`/`staff:<id>`), `agent_run_id`, `model`, `prompt_version`, `status`, `visible_to_client` (false по умолчанию для AI_HYPOTHESIS), `reviewed_by`, `reviewed_at`, ts | `id uuid`; FK session CASCADE, companies | `(session_id)`, `(company_id, status, severity)` | Клиент: `can_read_company AND visible_to_client`; staff — все | active\|superseded\|dismissed; ревью → `admin_audit_log` |
| `diagnostic_recommendations` | `session_id`, `finding_ids uuid[]`, `title`, `body`, `impact`, `effort`, `priority`, `horizon` 30\|90\|180, `provenance_type`=RECOMMENDATION, `confidence`, `produced_by`, `agent_run_id`, `status` | `id uuid`; FK session, companies | `(company_id, status)`; GIN `finding_ids` | `can_read_company` | proposed\|accepted\|rejected\|done; `action_items.recommendation_id` (новая FK-колонка) для конвертации в задачу |
| `metric_value_history` | `metric_id`, `company_id`, `metric_key`, период, `scenario`, `source`, `value`, `confidence`, `provenance`, `provenance_type`, `session_id`, `recorded_at` | `bigint identity` | `(company_id, metric_key, recorded_at desc)` | `can_read_company` | Append-only; пишет AFTER INSERT/UPDATE trigger на `metrics` только при изменении значения |
| `metric_targets` | `metric_key`, `period_*`, `target_value`, `source` owner\|expert\|agent, `set_by`, ts | `id uuid`; FK companies | UNIQUE `(company_id, metric_key, period_year, period_quarter, period_month)` NULLS NOT DISTINCT | `can_read_company` | Изменение цели — новая версия или аудит `set_by` |
| `metrics` (ALTER) | + `provenance_type`, + `session_id` | — | `(session_id)` | Guard-триггер: владелец не может писать `source/confidence/provenance/provenance_type` | Закрывает R5 для метрик |
| `documents` (ALTER, частично) | Guard-триггер на `parsed_data` | — | — | Владелец не может менять `parsed_data` | Расширяется в 088 |
| `report_versions` (D5: 085 или 088) | `session_id`, `report_type` point_a\|full\|gri\|point_b, `version int`, `status`, `title`, `content jsonb`, `provenance jsonb {agent_key, run_ids, model, prompt_version, tools, sources, data_hash, generated_at}`, `confidence`, `pdf_storage_path`, `created_by`, `published_by`, `published_at`, ts | `id uuid`; UNIQUE `(company_id, report_type, version)` | `(company_id, report_type, status)` | Клиент: `can_read_company AND status='published'` | draft\|ready\|published\|superseded\|failed; shared-ссылки указывают на версию |

Также в 085: partial unique `diagnostics(user_id) WHERE is_current` и запись диагностик через service role (R8); `search_path` для оставшихся 4 триггер-функций; фильтр `is_approved` в `point_b_versions_owner_read` (R7).

### 086 — агенты (D3) ⬜

| Объект | Ключевые колонки | PK / FK | Индексы | Статусы / аудит |
|---|---|---|---|---|
| `agent_configs` | `enabled`, `model_override`, `tier_override`, `schedule_cron`, `daily_budget_usd`, `per_run_budget_usd`, `max_tokens`, `settings jsonb`, `updated_by` | PK `agent_key` | — | Каждая правка → `recordAdminAction` |
| `agent_permission_grants` | `agent_key`, `permission`, `decision` ALLOW\|DENY\|REQUIRE_APPROVAL, `updated_by` | PK `(agent_key, permission)` | — | Не может ослабить потолок из кода (проверка в runtime + CHECK в API) |
| `agent_tasks` | `agent_key`, `company_id`, `session_id`, `parent_task_id`, `trigger` manual\|event\|schedule\|agent, `trigger_ref`, `requested_by`, `input jsonb`, `idempotency_key`, `status`, `priority`, `attempts`, `max_attempts`, `run_after`, `lease_token`, `lease_until`, `last_error`, `result_summary`, ts | `id uuid`; UNIQUE `idempotency_key`; FK self (`parent_task_id`) | `(status, run_after, priority)` для claim; `(lease_until) WHERE status='running'`; `(company_id, created_at)` | queued\|running\|awaiting_approval\|succeeded\|failed\|dead\|cancelled; backoff; `dead` = DLQ |
| `agent_runs` | `task_id`, `agent_key`, `agent_version`, `company_id`, `status`, `model`, `tier`, `prompt_version`, `input_summary`, `output_summary`, `tools_used text[]`, `tokens_in`, `tokens_out`, `cost_usd`, `llm_calls`, `started_at`, `finished_at`, `duration_ms`, `error_code`, `error_message` (редактированный), `sources jsonb` | `id uuid`; FK task CASCADE | `(task_id)`, `(agent_key, started_at desc)`, `(company_id, started_at desc)`, `(started_at)` для сумм стоимости | running\|succeeded\|failed\|cancelled; неизменяем после завершения |
| `agent_tool_calls` | `run_id`, `seq`, `tool`, `permission`, `decision` allowed\|denied\|approval_required, `args_redacted jsonb`, `result_summary`, `status` ok\|error\|denied\|pending_approval, `duration_ms`, `approval_id`, `created_at` | `bigint identity`; FK run CASCADE; UNIQUE `(run_id, seq)` | `(run_id, seq)` | Append-only |
| `agent_approvals` | `task_id`, `run_id`, `agent_key`, `company_id`, `action`, `permission`, `summary`, `payload jsonb`, `payload_hash`, `status`, `requested_at`, `expires_at`, `decided_by`, `decided_via` admin\|telegram, `decision_reason`, `executed_at` | `id uuid`; FK task, run | `(status, expires_at)`, `(company_id)` | pending\|approved\|rejected\|expired\|executed; решение → `admin_audit_log`; исполнение перепроверяет `payload_hash` |
| `agent_events` | `task_id`, `run_id`, `agent_key`, `company_id`, `level` debug\|info\|warn\|error, `type`, `message`, `data jsonb`, `created_at` | `bigint identity` | `(run_id)`, `(agent_key, created_at desc)`, `(level, created_at) WHERE level in ('warn','error')` | Append-only; без секретов/PII; ретенция — предлагается 90 дней |
| `platform_events` | `name`, `company_id`, `subject_type`, `subject_id`, `payload`, `created_at`, `dispatched_at` | `bigint identity` | `(created_at) WHERE dispatched_at IS NULL`, `(company_id, created_at)`, `(name, created_at)` | Outbox; повторная отправка недоставленных — cron |

Все таблицы 086: RLS ON, запись — service role; чтение — см. базис выше.

### 087 — уведомления и Telegram (D4) ⬜

| Объект | Ключевые колонки | PK / FK | Индексы | Статусы / аудит |
|---|---|---|---|---|
| `notification_events` | `level` INFO\|SUCCESS\|WARNING\|CRITICAL\|APPROVAL_REQUIRED, `type`, `title`, `body`, `company_id`, `entity_type`, `entity_id`, `approval_id`, `data jsonb`, `dedupe_key`, `audience` staff\|client, `created_at` | `id uuid`; UNIQUE `dedupe_key`; FK `agent_approvals` | `(audience, created_at desc)`, `(level, created_at desc)` | Неизменяемы |
| `notification_deliveries` | `event_id`, `channel` telegram\|email\|in_app, `target`, `status` queued\|sent\|failed\|skipped, `attempts`, `provider_message_id`, `error`, `sent_at` | `id uuid`; FK event CASCADE | `(status, created_at)`, `(event_id)` | `provider_message_id` хранит Telegram message id для правки карточки одобрения |
| `staff_telegram_links` | `telegram_user_id`, `chat_id`, `linked_at`, `link_code_hash`, `link_code_expires_at` | PK `user_id`; UNIQUE `telegram_user_id` | — | Привязка/отвязка → `admin_audit_log`; код хранится только хэшем |
| `system_settings['notification_routing']` | мин. уровень на канал, тихие часы, mute по типу | — | — | INFO в Telegram по умолчанию не отправляется |

### 088 — файлы (D6) ⬜

| Объект | Изменение |
|---|---|
| `documents` (ALTER) | + `storage_path`, `size_bytes`, `sha256`, `sniffed_mime`, `security_status` pending\|clean\|rejected, `security_reason`, `processing_stage`, `attempts`, `session_id`, `processed_at`, `updated_at` |
| Индексы | `(user_id, sha256)` для дедупа; `(processing_stage, updated_at)` для reaper; `(session_id)` |
| Guard-триггер | Владелец не может менять `parsed_data`, `parse_status`, `security_*`, `processing_stage` |
| Статусы | Существующий CHECK `parse_status` (queued\|processing\|parsed\|completed\|error) + `needs_ocr` (D6); «processed» в UI только при `parsed` с полями |
| Хранилище | Один приватный бакет, путь под папкой вызывающего; `file_url` с годовой подписью больше не пишется |

## 4. Запрошенные сущности → таблицы

| Сущность | Таблица | Новая / существующая | Почему |
|---|---|---|---|
| organizations | `partner_organizations` (+ `companies` как тенант) | новая (084) | Prisma `organizations` — cuid/NextAuth-эпоха, заморожена (D1) |
| users | `auth.users` + `profiles`; `company_members`, `partner_members` | существующая + новые | Supabase Auth — единственный источник идентичности |
| clients | `companies` (+ `company_members`) | существующая | Тенант = компания; Prisma `clients`, `crm_clients`, `omnichannel_contacts` — другие понятия |
| diagnostic_sessions | `diagnostic_sessions` | новая (085) | Зонтика сейчас нет; `diagnostics` — снимок на один пересчёт |
| onboarding_answers | `survey_answers` (+ `survey_answer_history`) | существующая | Рабочая модель с историей |
| questionnaire_answers | `survey_answers`, `market_analysis_answers`, `founder_psych_profiles` | существующие | Разные анкеты, общий ключ `user_id` |
| tests | определения в коде (`lib/gri-assessment/sections.ts`, `lib/market-analysis/questions.ts`) | код | Определения версионируются PR-ами |
| test_results | `gri_assessments` (+ drafts, pulse, calc_sessions) | существующие | Версии и `is_current` уже есть |
| uploaded_files | `documents` | существующая + ALTER (088) | Одна таблица файлов; `ai_journey_files` — отдельный гостевой поток |
| file_processing_jobs | `agent_tasks` (agent `document_intelligence`) + `documents.processing_stage/attempts` | новая (086) + ALTER (088) | Одна очередь для всех фоновых задач вместо отдельной job-таблицы |
| extracted_documents_data | `documents.parsed_data` | существующая | Guard от правки владельцем (085/088) |
| metrics | каталог в коде (`lib/metrics/registry.ts`) + файл таксономии | код | D2: каталог остаётся в коде |
| metric_values | `metrics` + `metric_value_history` + `metric_targets` | существующая + новые (085) | История и цели без смены контракта резолвера |
| diagnostic_findings | `diagnostic_findings` | новая (085) | Нормализует JSONB `diagnostics.risks/insights/quick_wins/data_gaps` |
| reports | `report_versions` | новая (085/088) | Prisma `reports` — это загруженные файлы, не отчёты |
| recommendations | `diagnostic_recommendations` → `action_items.recommendation_id` | новая (085) | `action_items` остаётся исполняемым списком задач |
| integrations | `crm_provider_connections` (+ шифрование), `omnichannel_settings` | существующие | Prisma `crm_integrations` мёртв (RLS ON с 083) |
| agent_runs | `agent_runs` | новая (086) | — |
| agent_actions | `agent_tool_calls` (+ `agent_approvals`) | новая (086) | Действие агента = вызов инструмента |
| agent_tasks | `agent_tasks` | новая (086) | Durable-очередь с lease/backoff/DLQ |
| agent_events | `agent_events` + `platform_events` | новые (086) | Лог агента отдельно от доменных событий |
| notifications | `notification_events` + `notification_deliveries`; `app_notifications` остаётся лентой клиента | новые (087) | Уровни, журнал доставок, ссылки на одобрения |
| audit_logs | `admin_audit_log` | существующая | Append-only, fail-closed; Prisma `audit_logs` — legacy dual-write |
