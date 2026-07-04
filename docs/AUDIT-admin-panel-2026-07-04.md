# Аудит и ТЗ: админ-панель AIStart360 (портал бизнес-диагностики)

**Дата:** 2026-07-04
**Автор аудита:** архитектурный/security/QA-разбор реального кода (ветка `claude/wonderful-knuth-015991`)
**Стек:** Next.js 14 App Router, TypeScript 5, Supabase (Auth + Postgres + RLS), Prisma (частично мёртв), OpenRouter (AI), Resend (email), Zustand.

> Всё ниже привязано к конкретным файлам и строкам. Номера строк — на момент аудита; проверяйте при правках.

---

## A. Executive Summary

**Текущее состояние.** Админ-панель функциональна на бумаге, но фрагментирована и содержит критический баг подтверждения пользователей. Есть **три конкурирующих админ-namespace** и **три несвязанных backend-а подтверждения**, пишущих в разные таблицы разными enum-значениями. RBAC на «правильном» namespace (`/api/admin/*`) на удивление крепкий; на «гига-панели» (`/admin-giga-panel`) — отдельный слабый вход по общему паролю. Инсайты не имеют гейта подтверждения. 2FA реализована технически грамотно, но **не имеет ни одного recovery-механизма** → возможна вечная блокировка аккаунта. Тумблера режима регистрации нет вообще.

**Главные риски (по убыванию):**
1. **P0 — подтверждение пользователей не работает** через основную (гига) панель: запись статуса молча отбрасывается RLS, UI «врёт» из-за оптимистичного апдейта. Пользователи навсегда застревают в «комнате ожидания».
2. **P0 — вечная блокировка по 2FA**: нет admin-reset, нет email-fallback, нет recovery. Один аккаунт уже заблокирован.
3. **P1 — три источника истины по статусу пользователя** (`profiles.status` vs Prisma `admin_requests`/`users`) с несовпадающими enum → любые будущие правки approve будут ломаться.
4. **P1 — IDOR на инсайтах**: сотрудник может править/удалять инсайты любого пользователя (RLS это разрешает), без аудита.
5. **P1 — гига-панель на общем пароле** без Supabase-идентичности: действия не атрибутируются к человеку, не логируются в audit, обходят RBAC-матрицу.
6. **P2 — email через Resend деградирует молча**: письма о принятии/отклонении пользователю не шлются вообще; ошибки отправки не видны.

**Что исправить первым (максимальный эффект):**
- Починить путь approve гига-панели (service-role запись в `profiles.status`, правильные колонки, проверка `res.ok` + refetch в UI). → снимает P0 №1.
- Добавить admin-endpoint сброса 2FA + backup-код на email при включении. → снимает P0 №2.
- Свести три approve-бэкенда к одному источнику истины (`profiles.status`). → устраняет класс багов.

---

## B. Карта текущих проблем

| Зона | Проблема | Симптом | Причина (файл:строка) | Риск | Приоритет |
|---|---|---|---|---|---|
| Подтверждение | Approve не сохраняется | UI «Принято», юзер в ожидании, откат после reload | RLS отбрасывает UPDATE `profiles` (0 строк, без ошибки), т.к. гига-сессия без `auth.uid()` — `app/api/giga-admin/requests/[id]/route.ts:24,57` + `supabase/migrations/006_fix_rls_recursion.sql:28` | Критический | **P0** |
| Подтверждение | Свалка источников истины | «Принял в одной панели — не видно в другой» | 3 backend-а: `profiles.status` vs Prisma `admin_requests`/`users.status='active'` — `app/api/admin/requests/[id]/approve/route.ts:40` | Критический | **P0** |
| Подтверждение | camelCase/snake_case | `admin_requests` update — no-op | Prisma-таблица с `"userId"`, роут пишет `updated_at` — `route.ts:31` vs `scripts/init-schema.sql:255` | Высокий | **P0** |
| Подтверждение | Оптимистичный UI, ошибки проглочены | Кнопка «сработала», непонятно что произошло | нет `res.ok`/refetch — `components/giga-panel/RequestsModule.tsx:273` | Высокий | **P0** |
| Статусы | `{ok:true}` при 0 строк | Сервер рапортует успех при провале | `route.ts:89` не проверяет affected rows | Высокий | **P0** |
| 2FA | Вечная блокировка | «Коды не приходят, войти нельзя» | нет admin-reset, нет email-fallback, нет recovery — `app/api/v1/security/2fa/*`, отсутствует admin-роут | Критический | **P0** |
| Email/Resend | Молчаливая деградация | Письма не приходят, ошибок не видно | `lib/email.ts:31`, `app/actions/auth.ts:250,253` возвращает `success` независимо | Средний | **P1** |
| Email | Нет писем о принятии/отклонении | Юзер не узнаёт, что принят | нет вызова email в approve-роутах | Средний | **P1** |
| Регистрация | Нет тумблера режима | Нельзя открыть/закрыть саморегистрацию | хардкод `status='pending_approval'` — `app/api/auth/register/route.ts:47` | Средний | **P1** |
| Инсайты | Нет гейта подтверждения | AI-инсайт сразу виден юзеру | вставка со `status='pending_confirmation'` + RLS owner-read — `app/api/v1/point-a/insights/ai-generate/route.ts:62` | Высокий | **P1** |
| Инсайты | Нет версионирования/истории | Не видно, кто и когда менял | `answer_text` перезаписывается, нет `insight_versions` | Средний | **P2** |
| Права | IDOR на инсайтах | Сотрудник правит чужие инсайты | RLS staff-update любой строки — `supabase/migrations/024_point_a_insights.sql:120` | Высокий | **P1** |
| Права | Гига-панель на общем пароле | Действия не атрибутируются к человеку | `app/api/giga-admin/auth/route.ts:53` — только HMAC-cookie | Высокий | **P1** |
| Аудит | Гига-approve и insight-PATCH не логируются | Нет следа критических действий | нет `logAudit()` в `giga-admin/*` и `insights/[id]` | Средний | **P1** |
| Безопасность | CRM-токены в открытом виде | Утечка при дампе БД | `prisma/schema.prisma:460` (`accessToken TEXT`) | Высокий | **P2** |
| Безопасность | Нет обяз. MFA для super_admin | Компрометация без 2-го фактора | `middleware.ts:165` — MFA только если включена | Средний | **P2** |
| Надёжность | Нет disabled/анти-даблклик в гига-UI | Двойные PATCH | `RequestsModule.tsx` без `pendingId` | Низкий | **P2** |
| Управление | Разрозненные админ-разделы | Часть функций — заглушки/мок | инвентаризация ниже (раздел C) | Средний | **P2** |

---

## C. Целевая архитектура админ-панели

**Стратегическое решение (рекомендация):** сделать **одну** каноничную админ-панель. Есть два кандидата:
- **Гига-панель** (`/admin-giga-panel`) — задумана как «супер-админ консоль», но на общем пароле и с битым approve.
- **`(dashboard)/admin`** — на теме портала, с корректным `PendingClientsTable` и крепким RBAC (`requirePermission`).

Рекомендация: **консолидировать на инфраструктуре `(dashboard)/admin` + `/api/admin/*` (RBAC + audit)**, а гига-панель либо убрать, либо перевести на настоящую Supabase-сессию super_admin (без общего пароля). Единственный источник истины по доступу — **`profiles.status`**.

Текущая инвентаризация разделов (present / partial / absent):

| # | Раздел | Статус | Где |
|---|---|---|---|
| 1 | Dashboard администратора | present | `(dashboard)/admin/page.tsx` (ОБЗОР), `components/dashboard/SystemHealth.tsx` |
| 2 | Пользователи | present | `(dashboard)/users/page.tsx` (add user — мок), `components/giga-panel/CRMModule.tsx`, `api/admin/users`, `api/v1/admin/clients` |
| 3 | Заявки на доступ | present (дубль, один битый) | `RequestsModule.tsx` (битый approve), `PendingClientsTable.tsx` (корректный), `(dashboard)/admin/requests` (read-only) |
| 4 | Инсайты | partial | `(dashboard)/insights/page.tsx`, `MarketInsightsModule.tsx`, `api/v1/point-a/insights/*` |
| 5 | Диагностика | partial | внутри `UserDetailPanel.tsx`, `giga-admin/requests/[id]/diagnostics` — нет отдельной страницы |
| 6 | Метрики | present (клиентские) | `(dashboard)/metrics/page.tsx` — не админ-скоуп |
| 7 | AI-ассистенты | partial | `components/settings/AssistantSettingsPanel.tsx` — пер-юзер, не системная консоль |
| 8 | API-провайдеры | partial | `SettingsClient.tsx:681` (плитка «API-ключи») — нет управления провайдерами |
| 9 | MCP-провайдеры | absent | только backend market-analysis, UI нет |
| 10 | Интеграции | partial (заглушки) | `SettingsClient.tsx:675` — Telegram/WhatsApp/Notion = `coming` |
| 11 | Эквайринг/платежи | partial (stub, by design) | `SettingsClient.tsx` Биллинг |
| 12 | Email и уведомления | absent (UI) | только серверные TODO (`request-info/route.ts`) |
| 13 | Безопасность и 2FA | present | `app/2fa/page.tsx`, `api/v1/security/2fa/*`, `webauthn/*` |
| 14 | Роли и права | partial | `UserSettingsModal.tsx`, `users/[id]/widgets` — нет permission-matrix UI |
| 15 | Логи и аудит | present (backend) | `api/admin/audit`, `lib/audit.ts` — нет отдельной страницы-вьюера |
| 16 | Настройки портала | present | `SettingsClient.tsx` (9 вкладок) |
| 17 | Системное здоровье | present | `SystemHealth.tsx`, `api/admin/overview` |
| — | **Тумблер режима регистрации** | **absent** | нигде |

**Для каждого целевого раздела** (назначение / данные / действия / endpoints / таблицы / edge cases) — детально в разделах G–I ниже. Ключевые добавления: единый раздел «Заявки» на одном backend; раздел «Инсайты» с lifecycle draft→pending_review→approved→published; раздел «Безопасность» с admin-reset 2FA; раздел «Настройки портала» с `system_settings` (режим регистрации, feature flags); раздел «Логи» как страница-вьюер `AuditLog`.

---

## D. User Approval Flow (корректная логика)

### Текущая читающая сторона (важно для фикса)
- `middleware.ts:53-65,110-113` — читает **только `profiles.role`**, статус НЕ проверяет.
- `stores/auth.store.ts:114-116` — `status = profiles.status || user_metadata.status || 'approved'` (⚠ дефолт `approved` при null — потенциальная дыра).
- `app/(auth)/login/page.tsx:31-34` — `pending_approval` → `/client/waiting-room`; `approved` → `/client/point-a`.
- `app/client/waiting-room/page.tsx:74-90` → polls `GET /api/client/status` (service-role read, `api/client/status/route.ts:27-45` — работает).

**Вывод:** единственный источник истины доступа для клиента — **`profiles.status`**. Любой approve обязан выставить именно его в `'approved'` через клиент, проходящий RLS (service-role или настоящая admin-сессия).

### State machine статуса пользователя (целевая)

Значения (Supabase `profiles.status`, CHECK — `001_onboarding_system.sql:29`):
`pending_approval` → `approved` | `rejected` | `requires_clarification`; плюс операционный `blocked` (добавить).

| Из | Событие | В | Кто | Транзакция/сайд-эффекты |
|---|---|---|---|---|
| (нет) | регистрация | `pending_approval` | система | INSERT profiles (trigger `handle_new_user`), + INSERT `admin_requests` |
| `pending_approval` | admin approve | `approved` | admin/super_admin | UPDATE profiles.status + approved_at/by; audit; email юзеру |
| `pending_approval` | admin reject | `rejected` | admin | UPDATE + rejection_reason; audit; email |
| `pending_approval` | нужны данные | `requires_clarification` | admin | UPDATE; email с вопросом |
| `requires_clarification` | юзер дослал | `pending_approval` | система | UPDATE; уведомление админам |
| `rejected` | повторная заявка | `pending_approval` | система | новый `admin_requests`; аудит |
| `approved` | блокировка | `blocked` | admin | UPDATE; инвалидация сессии; audit; email |
| `blocked` | разблокировка | `approved` | admin | UPDATE; audit |

### Требования
- **Транзакции:** approve = один атомарный write в `profiles` (+ синхронно `admin_requests.status` для истории) через service-role; при провале — 500, откат UI.
- **Frontend:** после мутации — обязательный `await refetch()` из БД; отображать статус только из серверных данных; `disabled` во время запроса; `toast.error` при `!res.ok`.
- **Идемпотентность:** approve повторно = no-op с `{ok:true, already:true}`.
- **Логирование:** каждый переход → `logAudit()` с `performedBy` (реальный человек, не «giga»).
- **Уведомления:** email юзеру о принятии/отклонении (сейчас отсутствует).

### Тест-кейсы (см. раздел M).

---

## E. 2FA Recovery Design

**Что есть (migration 039, `supabase/migrations/039_user_security.sql`):**
- `user_security`: `totp_enabled`, `totp_secret_enc` (AES-256-GCM `v1:iv:tag:ct`), `totp_pending_enc`, `backup_codes` (bcrypt-хэши), — RLS ON, **без клиентских политик** (только service-role).
- `webauthn_credentials`: passkeys (id, public_key, counter, …).
- Роуты: `2fa/setup`, `2fa/verify` (генерит 10 backup-кодов, отдаёт **один раз**, `verify/route.ts:81`), `2fa/challenge` (rate-limit 10/5мин), `2fa/disable`, `backup-codes/regenerate`.
- Enforcement: `middleware.ts:165-184` — если `mfa_totp/mfa_webauthn` в JWT и нет валидного step-up cookie (12ч, `lib/mfa/step-up.ts:11`) → редирект на `/2fa`, **все роуты заблокированы**.

**Корень вечной блокировки (подтверждено):** нет ни одного пути восстановления, если совпало: (1) TOTP включён, (2) backup-коды не сохранены/исчерпаны, (3) нет passkey, (4) аутентификатор потерян. **Нет admin-endpoint сброса 2FA**, **нет email-fallback**, **нет recovery-flow**.

**Целевой безопасный дизайн:**
1. **Admin-reset 2FA** — новый роут `POST /api/admin/users/[id]/2fa/reset` (только super_admin, `requirePermission('users:write')` + step-up самого админа), очищает `user_security` для юзера, пишет audit, шлёт юзеру email-уведомление. Плюс UI-кнопка в карточке пользователя.
2. **Email backup-кодов** при включении 2FA (в дополнение к показу на экране) — устраняет «не сохранил».
3. **Резервный канал** для challenge: одноразовый email-код при отсутствии TOTP (rate-limited), опционально включаемый.
4. **Emergency admin recovery:** документированная процедура + защита от «последний super_admin потерял 2FA» — запретить отключать 2FA у последнего активного super_admin без второго super_admin/CLI-скрипта.
5. **Аудит всех попыток** входа/challenge (сейчас только in-app notification).
6. **Rate limits** уже есть (10/5мин challenge, 5/5мин regenerate) — сохранить.

**Тест-кейсы:** включение→verify→backup-коды; вход по backup-коду; исчерпание кодов→admin-reset; disable требует TOTP/backup; admin-reset пишет audit + email; последний super_admin не может залочить себя.

---

## F. Insight Management System

**Текущее (`point_a_insights`, migration 024):** статусы `pending_ai | pending_confirmation | awaiting_answer | confirmed | rejected`. AI (`lib/insights/ai-generator.ts:217`, OpenRouter Claude Sonnet 4.5) вставляет со `status='pending_confirmation'` → RLS owner-read → **юзер сразу видит** (`ai-generate/route.ts:62-88`). **Гейта подтверждения админом нет. Версионирования нет.**

**Целевая модель:** ввести жизненный цикл и разделить «внутренний» статус модерации от «пользовательского».
- Статусы: `draft` → `ai_generated` → `pending_review` → `approved` → `published` → `rejected` → `archived`.
- Поля: `created_by` (`ai`|`admin`|`expert`|`client`), `reviewed_by`, `approved_by`, `published_at`, `visible_to_user` (bool, по умолчанию false для AI до approve), `priority`, `category`, `diagnostic_section`, `source_meta`.
- Таблица истории `insight_versions` (insight_id, version, diff, changed_by, changed_at).
- **Гейт публикации:** `visible_to_user=true` ставится только при переходе в `published`; RLS owner-read фильтрует по `visible_to_user`.
- Режим авто-публикации — опционально через `system_settings.insights_auto_publish`.

**Endpoints:** генерация AI (draft), ручное создание, edit, approve, publish, hide, delete, list-by-user, version-history (см. раздел H).

**UI flow:** админ выбирает юзера → видит диагностику → «Сгенерировать AI» / «Написать вручную» → редактирует → «Подтвердить» → «Опубликовать». Бейджи: кто создал (AI/админ), кто подтвердил, когда стал виден.

**Тест-кейсы:** AI-инсайт не виден юзеру до publish; админ публикует → юзер видит; edit создаёт version; IDOR закрыт (см. K/M).

---

## G. Database Audit & Schema Proposal

### Живые таблицы (Supabase — источник истины в проде)
- `public.profiles` — `id`, `email`, `full_name`, `role` (`super_admin|admin|manager|analyst|client|expert|owner`), `status` (`pending_approval|approved|rejected|requires_clarification`), `approved_at/by`. **Источник истины доступа и ролей.** (`001_onboarding_system.sql:22-41`)
- `public.companies`, `public.gri_assessments`, `public.point_a_insights`, `public.activity_log` (036), `public.app_notifications` (037), `public.assistant_events` (038), `public.user_security` (039), `public.webauthn_credentials` (039).

### Живые таблицы (Prisma — бизнес/админ-логика)
- `admin_requests` (Prisma `AdminRequest`, `schema.prisma:407-440`, `@@map`), `Comment`, `AuditLog` (`484-498`). ⚠ camelCase-колонки в кавычках, **RLS не включена** (`init-schema.sql:255`).

### Мёртвое (не использовать)
- Prisma `User/Account/Session/VerificationToken` (NextAuth) — не участвуют в auth. `User.role` (`SUPER_ADMIN|ADMIN|MANAGER|ANALYST|CLIENT`) и `User.status` (`active|blocked`) — **не читаются** логином.

### Ключевая проблема схемы
**Двойной/тройной источник истины по статусу пользователя:** `profiles.status` (Supabase, enum A) vs Prisma `admin_requests.status` (enum B: `new|in_review|…|approved|rejected`) vs Prisma `users.status` (enum C: `active|blocked`). Три несовместимых enum на одну сущность.

### Предложение (целевые сущности)
Свести к Supabase как единому источнику + добавить недостающее:
- `system_settings` (key/value JSONB) — **режим регистрации**, feature flags, insights_auto_publish. **Новая.**
- `user_approval_requests` — заменить/унифицировать `admin_requests` в Supabase (user_id, status, payload, reviewed_by, decided_at) с RLS. **Рефактор.**
- `insight_versions` — история инсайтов. **Новая.**
- `email_events` (to, type, provider_id, status, error, created_at) — журнал писем. **Новая.**
- `admin_actions_audit_log` — перенести Prisma `AuditLog` в Supabase или оставить, но писать из всех путей (включая гига). **Дополнить.**
- `api_providers`, `mcp_providers`, `assistant_configs` (модель, temperature, system_prompt, ключ в шифре), `payment_providers`, `payments`, `subscriptions` — под будущие разделы. **Новые.**
- Шифрование: CRM-токены (`CrmIntegration.accessToken`) и API-ключи провайдеров — только в зашифрованном виде (как `totp_secret_enc`).
- Индексы: `profiles(status)`, `admin_requests(status, "userId")`, `point_a_insights(user_id, status)`, `audit_log(entityType, entityId, timestamp)`.

---

## H. API Design (ключевые endpoints)

Формат: метод / path / назначение / авторизация / сайд-эффекты / audit.

**Подтверждение (унифицировать на одном):**
- `POST /api/admin/users/[id]/approve` — approve. `requirePermission('requests:approve')` + service-role write `profiles.status='approved'`. Audit. Email юзеру. Идемпотентно.
- `POST /api/admin/users/[id]/reject` — reject + reason. Аналогично.
- `POST /api/admin/users/[id]/block` / `/unblock`.
- `GET /api/admin/pending-users` — список заявок (server-side, pagination).
- ⚠ Депрецировать `PATCH /api/giga-admin/requests/[id]` **или** перевести на service-role + правильные колонки.

**Режим регистрации:**
- `GET/PUT /api/admin/settings/registration` — чтение/смена режима (`open|approval|invite`). super_admin. Audit. Хранить в `system_settings`.

**Просмотр пользователя/портала:**
- `GET /api/admin/users/[id]` — профиль+анкета+документы+диагностика+метрики+инсайты.
- `POST /api/admin/users/[id]/impersonate` — безопасный view-as (см. I). Audit обязателен.

**Инсайты:**
- `POST /api/admin/users/[id]/insights/ai-generate` → `draft`/`pending_review` (не виден юзеру).
- `POST /api/admin/insights` — ручное создание.
- `PATCH /api/admin/insights/[id]` — edit (создаёт version, **добавить audit** — сейчас нет).
- `POST /api/admin/insights/[id]/approve` · `/publish` · `/hide` · `DELETE`.
- `GET /api/admin/insights/[id]/versions`.

**Метрики:** `POST/PATCH/DELETE /api/admin/users/[id]/metrics`.

**AI/MCP-провайдеры:** `GET/POST/PATCH /api/admin/ai-providers`, `.../test`, `GET/POST /api/admin/mcp-providers`, `.../health`.

**Resend:** `GET /api/admin/email/health` (проверка ключа), `GET /api/admin/email/events` (журнал).

**2FA/recovery:** `POST /api/admin/users/[id]/2fa/reset` (super_admin + step-up). `GET /api/admin/users/[id]/security`.

**Логи:** `GET /api/admin/audit` (есть, super_admin).

Для каждого — Zod-валидация входа, server-side проверка прав, единый error-envelope `{ok:false,error}`.

---

## I. Frontend Admin UX

Общие требования (антипаттерн «нажал — непонятно что»): у каждой мутации — `disabled`+спиннер во время запроса, проверка `res.ok`, `toast` успех/ошибка, **обязательный refetch из БД**, статус только из серверных данных, подтверждение для критических действий, empty/loading/error states.

**Заявки:** таблица (email, роль, дата, статус, источник), фильтры (статус/роль/дата), кнопки Принять/Отклонить/Запросить данные, модалка reject с причиной, бейдж реального статуса из БД. Эталон уже есть — `PendingClientsTable.tsx:42-60` (копировать паттерн в единый экран).

**Карточка пользователя:** табы Профиль/Анкета/Документы/Диагностика/Метрики/Инсайты/Безопасность/История; действия approve/reject/block/роль/сброс пароля/**сброс 2FA**/impersonate/экспорт.

**Impersonation (безопасно):** только admin+, обязательная плашка «Вы просматриваете портал как админ (view-as)», read-only для чувствительных действий, всё логируется, отдельный короткоживущий токен.

**Инсайты:** выбор юзера → просмотр диагностики → генерация/ручное → редактор → статусы draft/pending_review/approved/published → publish-гейт с явным подтверждением.

**Безопасность/2FA, Настройки (режим регистрации — тумблер с тремя режимами + предупреждение), Логи (вьюер AuditLog с фильтрами), Health.**

---

## J. Reliability & Anti-Lag Requirements

- Server-side валидация (Zod) на всех мутациях; никакого доверия фронту.
- Транзакции для approve/reject; **обязательный refetch** после критических мутаций; показ статуса из БД.
- `disabled`+спиннер, анти-даблклик (`pendingId`), идемпотентность approve.
- Timeout и обработка ошибок AI/email; ошибки видимы админу.
- Пагинация списков; debounce поиска; индексы БД (раздел G).
- `email_events` + retry для писем; health-checks (Resend, OpenRouter, MCP).
- Error boundaries; логирование ошибок сервера; audit всех действий (включая гига-путь).
- Убрать `create` без reconciliation в Zustand (`gigaPanel.store.ts:231`) — оптимизм только с откатом.

---

## K. Security Checklist (практический)

- [ ] Approve пишет `profiles.status` через service-role/admin-сессию (не anon) — `giga-admin/requests/[id]/route.ts`.
- [ ] Убрать общий пароль гига-панели или привязать к реальной super_admin Supabase-сессии — `giga-admin/auth/route.ts:53`.
- [ ] Закрыть IDOR инсайтов: RLS staff-update ограничить или добавить явную проверку + audit — `024_point_a_insights.sql:120`, `insights/[id]/route.ts`.
- [ ] Zod-валидация тела в `api/admin/requests/[id]` (enum priority/status) — `route.ts:45`.
- [ ] Шифровать CRM-токены и API-ключи (как `totp_secret_enc`) — `schema.prisma:460`.
- [ ] Обяз. MFA для super_admin — `middleware.ts:165`.
- [ ] Убрать fallback на anon-key в `supabase-admin-guard.ts:37` (fail hard).
- [ ] Ротация/expiry гига-cookie — `lib/giga-cookie.ts`.
- [ ] Audit во всех путях (гига-approve, insight-PATCH).
- [ ] Emergency recovery для super_admin 2FA (нельзя залочить последнего).
- [ ] `stores/auth.store.ts:114` — убрать дефолт `status='approved'` при null (fail-closed).
- [ ] Проверить, что каждый `/api/admin/*` и `/api/v1/admin/*` вызывает `requirePermission`/`requireSupabaseAdmin` (сейчас — да; держать инвариант).

---

## L. Implementation Plan (по этапам)

**Этап 0 (P0, срочно, ~0.5–1 день): починить approve.**
Цель: пользователь после «Принять» получает доступ. Файлы: `app/api/giga-admin/requests/[id]/route.ts` (service-role write в `profiles.status`, правильные колонки `admin_requests`, проверка affected rows → 404/500 при 0), `components/giga-panel/RequestsModule.tsx` (res.ok+refetch+disabled+toast+откат), опц. `stores/gigaPanel.store.ts`. Критерий: e2e «approve → profiles.status=approved → юзер входит»; при ошибке — виден toast, статус не меняется. Риск: RLS/ключи — проверить `SUPABASE_SERVICE_ROLE_KEY` на проде.

**Этап 1 (P0): 2FA recovery.** Admin-reset endpoint + UI, email backup-кодов, защита последнего super_admin. Файлы: новый `api/admin/users/[id]/2fa/reset`, `lib/email.ts`, карточка пользователя.

**Этап 2 (P1): единый источник истины по статусу.** Свести три approve-бэкенда к `profiles.status`; депрецировать/переписать гига-путь; выровнять enum. Риск: миграция данных — сверить `admin_requests` ↔ `profiles`.

**Этап 3 (P1): Resend.** `email_events`, письма о принятии/отклонении, видимые ошибки, retry, health-endpoint.

**Этап 4 (P1): тумблер режима регистрации.** `system_settings` + `GET/PUT /api/admin/settings/registration` + ветвление в `register/route.ts:47` + UI-тумблер.

**Этап 5 (P1): инсайты.** Lifecycle draft→…→published, `visible_to_user`-гейт, `insight_versions`, audit на PATCH, закрыть IDOR.

**Этап 6 (P1): раздел пользователей.** Единый экран заявок + карточка + impersonation + экспорт.

**Этап 7 (P2): диагностика/метрики CRUD, AI/MCP-провайдеры, интеграции/эквайринг, permission-matrix UI, страницы audit/health.**

**Этап 8 (P2): безопасность/шифрование/MFA-mandate, финальная полировка UX, мониторинг.**

Каждый этап: unit+integration+e2e+security-тесты (раздел M), критерии приёмки (раздел N).

---

## M. QA Test Plan

**Unit:** маппинг ролей `lib/rbac.ts`; enum-переходы статуса; `verifyTOTP`/backup-код consume; email-шаблон escape.

**Integration (API):**
- approve → `profiles.status='approved'` в БД; повторный approve идемпотентен; approve без прав → 403; approve при 0 строк → 5xx (не `{ok:true}`).
- reject → `rejected` + reason + email.
- register: без тумблера → `pending_approval`; режим `open` → `approved`; `invite` → отказ без инвайта.
- 2FA: enable→verify→backup; вход по backup; исчерпание→admin-reset; disable требует фактор.
- инсайт AI → не виден юзеру до publish; publish → виден; edit → version; staff не может править чужой (IDOR).

**E2E:** админ принимает пользователя → пользователь входит и видит портал; без подтверждения — «комната ожидания»; тумблер режима работает; 2FA lock → admin-reset → вход; админ видит портал юзера (view-as, read-only).

**Security:** RBAC не обходится с фронта; IDOR инсайтов закрыт; гига-путь атрибутируется и логируется; ключи не в открытом виде.

**Regression + manual checklist:** после каждого approve — статус из БД совпадает с UI после refetch.

---

## N. Acceptance Criteria

- Заявки корректно принимаются/отклоняются; статусы не зависают; после подтверждения пользователь получает доступ; админ видит актуальное состояние из БД (не оптимистичное).
- Единый источник истины по статусу (`profiles.status`).
- Тумблер режима регистрации работает (open/approval/invite).
- 2FA не блокирует навсегда: есть admin-reset + backup-коды на email + защита последнего super_admin.
- Resend шлёт письма о принятии/отклонении; ошибки видны; события в `email_events`.
- Инсайты: ручное + AI; AI не публикуется юзеру без approve; версии логируются.
- Все админ-действия логируются (включая гига-путь и insight-PATCH).
- Все админ-endpoints защищены server-side; IDOR закрыт; ключи зашифрованы.
- Критические операции покрыты тестами; UI показывает loading/error/success.

---

## O. Файлы для проверки/правки в первую очередь

**P0 — approve:**
1. `app/api/giga-admin/requests/[id]/route.ts` (service-role, колонки, affected rows, убрать `{ok:true}` при 0)
2. `components/giga-panel/RequestsModule.tsx:273` (res.ok + refetch + disabled + toast + откат)
3. `app/api/giga-admin/requests/route.ts:76,78` (маппинг статуса из `profiles`)
4. `lib/supabase-server.ts` vs service-role client (`app/api/client/status/route.ts:27` — эталон service-role read)
5. `supabase/migrations/006_fix_rls_recursion.sql:28` (политика `profiles_admin_update`)
6. `stores/gigaPanel.store.ts:252` (оптимизм без reconciliation)

**Эталон корректной реализации:** `components/dashboard/admin/PendingClientsTable.tsx:42-60` + `app/api/v1/admin/approve-user/route.ts`.

**P0 — 2FA:** `app/api/v1/security/2fa/*`, `middleware.ts:165-184`, `lib/mfa/step-up.ts` — добавить admin-reset.

**P1 — источники истины:** `prisma/schema.prisma:407-440,133-164`, `scripts/init-schema.sql:8,255`, `app/api/admin/requests/[id]/approve/route.ts:40`.

**P1 — email:** `lib/email.ts`, `app/actions/auth.ts:229-253`.

**P1 — регистрация:** `app/api/auth/register/route.ts:45-47`.

**P1 — инсайты/IDOR:** `app/api/v1/point-a/insights/[id]/route.ts:44`, `supabase/migrations/024_point_a_insights.sql:120`.

**RBAC (референс, менять осторожно):** `lib/rbac.ts`, `lib/supabase-admin-guard.ts`, `middleware.ts`.
