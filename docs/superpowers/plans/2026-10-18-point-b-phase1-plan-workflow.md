# Точка Б — Ф1 (данные и процесс плана): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Версионированный план Точки Б с процессом «черновик → проверка → одобрение старшим → публикация клиенту», верификацией и согласованием целей, уведомлениями, серверным гейтом PRO и единым путём записи экспертных правок.

**Architecture:** Новые таблицы `pb_plans`, `pb_plan_versions`, `pb_goal_reviews` (миграция 125, аддитивно; старые `point_b_analysis` и `point_b_versions` остаются). Доменная логика — чистые модули в `lib/point-b/plan/*` (машина статусов, условия одобрения), доступ к данным — `store.ts`/`goals.ts` на сервисном клиенте, маршруты GIGA/клиента — тонкие обёртки. Цели владельца по-прежнему живут в `metric_targets` (`lib/goals`); версия хранит их **снимок**. Совместимость: `lib/point-b/compat.ts` отдаёт клиентскому маршруту и потребителям «экспертную версию» из одобренной версии плана (запасной вариант — старая одобренная `point_b_versions`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service client, RLS), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§5–§6 роли и процесс, §8 данные, §16–§19, §21 Ф1). Предыдущий план: `2026-10-18-point-b-phase0-1b.md` (Ф0 и Ф1б должны быть закоммичены до начала).

## Global Constraints

- Тот же набор, что в плане Ф0/Ф1б: не трогать «Гри» (`lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`); не удалять отклонённые PO компоненты и старый движок; локальный `.env` = **продовая БД**: не запускать dev-сервер, не писать скриптами в БД, **миграцию 125 не применять** (применение — только по слову PO после зелёных тестов); тесты без сети и БД; нет данных → честное «данных не хватает»; фильтр мата на любой вводимый людьми текст; UI на русском, токены проекта без зашитых цветов.
- Версия плана, одобренная Admin/Super Admin, **неизменяема**; изменение = новая версия. Клиент видит только одобренную версию. Одобряют только `canApprovePointB(role)` (`lib/expert-review/point-b.ts`); экспертные действия требуют `clients.review` + `guardClientAccess`/`forbidTarget` (эксперт — только назначенные клиенты). Новых прав RBAC **не вводим** (упрощение §17 спеки: достаточно `clients.review` и `canApprovePointB`).
- Статусы версии (отклонение от §6 спеки, упрощение): `draft | in_review | approved | superseded`. Отклонение старшим возвращает версию в `draft` с `rejected_reason`, `rejected_by`, `rejected_at` (поля остаются на строке, действие пишется в аудит); отдельного статуса `rejected` нет.
- Статусы цели (по последней строке `pb_goal_reviews`): нет строк = `owner_draft`; `verified`, `corrected` (ждёт согласия), `agreed`, `disputed`.
- Все записи аудита — `recordAdminAction`; события — через `lib/events/registry.ts`.
- Каждая задача: `npx tsc --noEmit -p .`, `npx eslint <файлы>` чистые, тесты зелёные, отдельный коммит с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; перед отправкой в main — полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), `whatsapp-web-bridge-reliability`).
- Гейт тарифа: новая фича `point_b` в `lib/access/entitlements.ts` (`pro: true`, `free: false`); главный выключатель — существующий системный тумблер `access_gates` (по умолчанию выключен, это решение PO из прошлых фаз): пока он выключен, ограничений нет. Дефолт тумблера не меняется.

## Review Focus

- Одобрение версии при главной цели без проверки (`owner_draft`) → 409 с причиной; Admin с `exceptionReason` короче 10 символов → 400; с достаточной причиной → одобряет и пишет исключение в версию и аудит.
- Два одновременных «одобрить» одной версии → одна успешна, вторая 409; после одобрения прошлая одобренная становится `superseded`, а `published_version_id` указывает на новую.
- Попытка изменить одобренную или `in_review` версию (PATCH) → 409; попытка создать второй открытый черновик → 409 (один открытый на план).
- Эксперт не назначенного клиента; владелец отвечает на корректировку чужой цели; чужой `reviewId` → 403/404, записи в БД нет.
- Владелец без цели/без PRO/без компании: `GET /api/v1/point-b/plan` отдаёт пустое состояние (не 500); free-клиент при включённых гейтах получает 402; при выключенных — доступ как раньше.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `supabase/migrations/125_point_b_plans.sql` (new) | таблицы, индексы, триггер неизменяемости, RLS, бэкфилл из `point_b_versions` |
| `lib/point-b/plan/types.ts` (new) | типы плана, версии, снимка целей, статусов |
| `lib/point-b/plan/status.ts` (new) | чистая машина статусов и `checkApprovalConditions` |
| `lib/point-b/plan/store.ts` (new) | чтение/создание/правка/отправка/одобрение/возврат версий |
| `lib/point-b/plan/goals.ts` (new) | верификация целей, согласование владельцем, статусы целей |
| `lib/point-b/plan/notify.ts` (new) | события, уведомления, сообщения клиенту и персоналу |
| `lib/point-b/compat.ts` (new) | экспертная версия для старых потребителей из нового плана |
| `app/api/giga-admin/users/[id]/point-b/plan/**` (new) | GIGA/эксперт: план, версии, цели |
| `app/api/giga-admin/point-b/queue/route.ts` (new) | очередь «ждут одобрения» |
| `app/api/v1/point-b/plan/route.ts`, `app/api/v1/point-b/goals/[reviewId]/respond/route.ts` (new) | клиент |
| `lib/access/entitlements.ts`, `lib/access/gate.ts`, `app/api/v1/access/me/route.ts`, `hooks/useEntitlements.ts` (modify) | фича `point_b` |
| `app/api/v1/diagnostics/point-b/route.ts` (modify) | гейт + `expert_version` из compat |
| `app/api/expert/clients/[id]/point-b-version/route.ts`, `app/api/giga-admin/users/[id]/point-b/route.ts` (POST), `app/api/giga-admin/users/[id]/review/point-b/**` (modify) | запись и одобрение через план |
| `lib/events/registry.ts`, `lib/notifications/product.ts` (modify) | события и клиентские уведомления |
| `components/giga-panel/user360/point-b/PlanPanel.tsx`, `GoalReviewPanel.tsx` (new); `components/giga-panel/user360/PointBTab.tsx`, `review/PointBReview.tsx` (modify) | интерфейс эксперта |
| `app/admin-giga-panel/point-b-queue/page.tsx`, `lib/admin/nav.ts` (new / modify) | очередь админа |
| `components/point-b/PlanStatusBanner.tsx`, `GoalCorrectionCard.tsx`, `PointBPaywall.tsx` (new); `components/point-b/PointBContainer.tsx`, `app/client/point-b/page.tsx`, `app/(dashboard)/point-b/page.tsx` (modify) | интерфейс клиента |

---

### Task 1: Миграция 125 — планы, версии, проверки целей

**Files:**
- Create: `supabase/migrations/125_point_b_plans.sql`
- Test: `tests/unit/point-b/migration-125.test.ts` (по образцу `tests/unit/security/migration-084.test.ts`)

**Interfaces:**
- Produces (таблицы, все `IF NOT EXISTS`, RLS включён, `REVOKE ALL … FROM PUBLIC, anon`, запись только `service_role`):
  - `pb_plans(id uuid pk, company_id text unique → companies(id) on delete cascade, user_id uuid → auth.users on delete cascade, current_version_id uuid null, published_version_id uuid null, settings jsonb default '{}', created_at, updated_at)`.
  - `pb_plan_versions(id uuid pk, plan_id → pb_plans on delete cascade, version int, status text check in ('draft','in_review','approved','superseded'), base_snapshot_id uuid null → point_a_snapshots on delete set null, goals jsonb, assumptions jsonb default '{}', scenarios jsonb default '[]', selected_scenario text null, strategy jsonb default '{}', risks jsonb default '[]', expert_notes text null, change_reason text null, author_id uuid null, author_name text null, author_kind text check in ('owner','expert','admin','system'), submitted_at, approved_by uuid null, approved_at, approval_exception text null, rejected_by uuid null, rejected_at, rejected_reason text null, created_at, unique(plan_id, version))`; частичный уникальный индекс «один открытый на план»: `unique (plan_id) where status in ('draft','in_review')`.
  - `pb_goal_reviews(id uuid pk, company_id text → companies, metric_key text, period_label text, status text check in ('verified','corrected','agreed','disputed'), proposed_value numeric null, proposed_deadline date null, previous_value numeric null, reason text null, reviewer_id uuid null, reviewer_name text null, owner_agreed_at timestamptz null, applied_without_agreement boolean default false, reminded_at timestamptz null, created_at)`; индекс `(company_id, metric_key, period_label, created_at desc)`.
  - Триггер `pb_plan_versions_immutable`: у строки со статусом `approved` менять можно только `status` на `superseded` (иначе `RAISE EXCEPTION`).
  - Политики SELECT для `authenticated`: `pb_plans` — `user_id = auth.uid()`; `pb_plan_versions` — только `status = 'approved'` и план принадлежит `auth.uid()`; `pb_goal_reviews` — `public.can_read_company(company_id)`.
  - Бэкфилл (идемпотентный): для каждой компании с одобренной `point_b_versions` — план и версия 1 (`status 'approved'`, `expert_notes` из последней одобренной, `author_kind 'expert'`, `goals` из `metric_targets` на момент миграции или `{}`), `published_version_id` = эта версия.
- Consumes: `companies`, `point_a_snapshots`, `metric_targets`, `diagnostics`, `point_b_versions`, функция `public.can_read_company(text)`.

- [ ] **Step 1: Write the failing test** `migration-125.test.ts` (читает SQL как текст): `'creates the three tables idempotently'`; `'enables RLS and revokes anon on all three'`; `'one open version per plan index exists'`; `'immutability trigger allows only approved → superseded'`; `'client SELECT policy on versions is restricted to approved'`; `'backfill is guarded by ON CONFLICT DO NOTHING / NOT EXISTS'`; `'no INSERT/UPDATE grants to authenticated'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/migration-125.test.ts` → FAIL (файла нет).
- [ ] **Step 3: Implement** миграцию (стиль и шапка-комментарий — как `120_user_communications.sql`, в конце `NOTIFY pgrst, 'reload schema';`).
- [ ] **Step 4: Run** тест → PASS. **Миграцию к проду не применять.**
- [ ] **Step 5: Commit** `feat(point-b): migration 125 — plans, plan versions, goal reviews`.

### Task 2: Типы и чистая машина статусов

**Files:**
- Create: `lib/point-b/plan/types.ts`, `lib/point-b/plan/status.ts`
- Test: `tests/unit/point-b/plan-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PlanVersionStatus = 'draft' | 'in_review' | 'approved' | 'superseded'
  export type GoalReviewStatus = 'owner_draft' | 'verified' | 'corrected' | 'agreed' | 'disputed'
  export interface PlanGoalItem { metricKey: string; periodLabel: string; label: string | null; baselineValue: number | null; baselinePeriod: string | null; targetValue: number; deadline: string | null; reviewStatus: GoalReviewStatus }
  export interface PlanGoalsSnapshot { primary: { metricKey: string; periodLabel: string } | null; items: PlanGoalItem[] }
  export type Transition = 'submit' | 'approve' | 'reject' | 'supersede'
  export function canTransition(from: PlanVersionStatus, t: Transition): boolean
  export function isEditable(status: PlanVersionStatus): boolean            // только 'draft'
  export type ApprovalCheck = { ok: true; exception: boolean } | { ok: false; reasons: string[] }
  export function checkApprovalConditions(v: { goals: PlanGoalsSnapshot; changeReason: string | null }, opts?: { exceptionReason?: string | null }): ApprovalCheck
  export const EXCEPTION_REASON_MIN = 10
  ```
- Правила `checkApprovalConditions`: главная цель задана и её `reviewStatus ∈ {verified, agreed}`; `changeReason` непустой; при невыполнении цели Admin может одобрить с `exceptionReason` длиной ≥ 10 → `{ ok: true, exception: true }`; причина «нет причины изменений» исключением **не** обходится.

- [ ] **Step 1: Write the failing tests:** `'draft → in_review on submit only'`; `'in_review → approved on approve, in_review → draft on reject'`; `'approved can only be superseded'`; `'only draft is editable'`; `'approval fails without a verified primary goal and lists the reason'`; `'owner_draft, corrected and disputed primary goals block approval'`; `'agreed and verified pass'`; `'exception reason shorter than 10 chars is rejected'`; `'exception passes goal condition but not the missing change reason'`; `'no primary goal at all blocks approval'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** чистые функции (без IO), сообщения причин — по-русски («Главная цель не проверена экспертом», «Не указана причина изменений»).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): plan version state machine and approval conditions`.

### Task 3: Хранилище планов и версий

**Files:**
- Create: `lib/point-b/plan/store.ts`
- Test: `tests/unit/point-b/plan-store.test.ts` (in-memory мок как `tests/unit/comm/_db.ts`; при необходимости расширить мок операциями `neq`/`is`)

**Interfaces:**
- Produces (все принимают сервисный `SupabaseClient`):
  ```ts
  getOrCreatePlan(sb, companyId: string, userId: string): Promise<PlanRow>
  loadPlanBundle(sb, companyId: string): Promise<{ plan: PlanRow | null; versions: PlanVersionRow[]; open: PlanVersionRow | null; published: PlanVersionRow | null }>
  createDraft(sb, plan: PlanRow, input: { goals: PlanGoalsSnapshot; baseSnapshotId: string | null; author: { id: string; name: string; kind: 'owner' | 'expert' | 'admin' | 'system' }; changeReason: string | null; fromVersion?: PlanVersionRow | null }): Promise<PlanVersionRow>   // 409-подобная ошибка PlanError('open_exists'), если открытая версия уже есть
  updateDraft(sb, versionId: string, patch: { expertNotes?: string | null; changeReason?: string | null; goals?: PlanGoalsSnapshot; selectedScenario?: string | null }): Promise<PlanVersionRow>   // PlanError('not_editable') не для draft
  submitVersion(sb, versionId: string): Promise<PlanVersionRow>
  approveVersion(sb, versionId: string, actor: { id: string }, opts?: { exceptionReason?: string | null }): Promise<PlanVersionRow>
  rejectVersion(sb, versionId: string, actor: { id: string }, reason: string): Promise<PlanVersionRow>
  export class PlanError extends Error { code: 'open_exists' | 'not_editable' | 'bad_state' | 'conditions' | 'not_found'; reasons?: string[] }
  ```
- Consumes: Task 2 (`canTransition`, `isEditable`, `checkApprovalConditions`).
- Поведение: `approveVersion` — условный UPDATE `where status = 'in_review'` (проигравший гонку получает `bad_state`), затем прежняя `approved` → `superseded`, `pb_plans.published_version_id = id`, `current_version_id = id`; `rejectVersion` возвращает версию в `draft` и пишет `rejected_*`; `createDraft` с `fromVersion` копирует `assumptions`, `strategy`, `risks`, `expert_notes` и увеличивает номер версии.

- [ ] **Step 1: Write the failing tests:** `'getOrCreatePlan is idempotent per company'`; `'createDraft numbers versions 1, 2, 3 and copies content from the previous version'`; `'second open draft → PlanError open_exists'`; `'updateDraft on in_review or approved → not_editable'`; `'submit requires draft and sets submitted_at'`; `'approve checks conditions: unverified primary goal → conditions error with reasons'`; `'approve with a valid exception reason stores approval_exception'`; `'approve supersedes the previous approved and moves published_version_id'`; `'two concurrent approves: exactly one succeeds'`; `'reject returns to draft keeping reason, by and at'`; `'loadPlanBundle returns nothing for a company without a plan'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** на сервисном клиенте; бизнес-правила — только через функции Task 2; статусы меняются условными UPDATE-ами.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): plan store — create, edit, submit, approve (supersede), reject`.

### Task 4: Цели — верификация и согласование владельцем

**Files:**
- Create: `lib/point-b/plan/goals.ts`
- Test: `tests/unit/point-b/plan-goals.test.ts`

**Interfaces:**
- Produces:
  ```ts
  loadGoalStatuses(sb, companyId: string): Promise<Map<string, GoalReviewStatus>>      // ключ `${metricKey}|${periodLabel}`; нет строк → 'owner_draft'
  snapshotGoals(sb, companyId: string, primary?: { metricKey: string; periodLabel: string } | null): Promise<PlanGoalsSnapshot>   // metric_targets + статусы; primary по умолчанию — выручка '12m'
  reviewGoal(sb, input: { companyId: string; metricKey: string; periodLabel: string; action: 'verify' | 'correct' | 'reject'; value?: number; deadline?: string | null; reason?: string; reviewer: { id: string; name: string } }): Promise<{ review: GoalReviewRow; appliedDirectly: boolean }>
  respondToCorrection(sb, input: { reviewId: string; userId: string; accept: boolean }): Promise<GoalReviewRow>
  applyStaleCorrection(sb, reviewId: string, reviewer: { id: string; name: string }): Promise<GoalReviewRow>   // правило 14 дней, §6 спеки
  ```
- Правила (§6 спеки): цели у владельца нет → `reviewGoal` с `action: 'correct'` ставит цель **напрямую** (`upsertGoal` из `lib/goals/store.ts`, источник `expert`), статус `verified`, `appliedDirectly: true`; цель есть и `correct` → строка `corrected` с `proposed_value`/`proposed_deadline`/`previous_value`, `metric_targets` **не меняется**; `verify` → `verified`; `reject` без причины → ошибка; `respondToCorrection` принимает только владельца компании: `accept` применяет предложенное значение в `metric_targets`, статус `agreed`, `owner_agreed_at`; отказ → `disputed`; `applyStaleCorrection` допустим только для `corrected` старше 14 дней, применяет значение, ставит `applied_without_agreement = true`.

- [ ] **Step 1: Write the failing tests:** `'no goal for the owner: expert correction sets it directly, status verified'`; `'existing goal: correct creates a proposal and leaves metric_targets untouched'`; `'accepting applies the proposed value and records owner_agreed_at'`; `'disputing keeps metric_targets and sets disputed'`; `'only the company owner can respond; another user → PlanError not_found'`; `'verify marks the goal verified'`; `'reject without a reason throws'`; `'applyStaleCorrection refuses a correction younger than 14 days and applies an older one with applied_without_agreement true'`; `'snapshotGoals defaults the primary goal to revenue 12m and carries review statuses'`; `'the latest review row wins when several exist'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`lib/goals/store.ts` не менять; использовать его функции; фильтр мата на `reason`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): goal verification and owner agreement`.

### Task 5: События, уведомления и сообщения

**Files:**
- Create: `lib/point-b/plan/notify.ts`
- Modify: `lib/events/registry.ts` (`POINT_B_PLAN_SUBMITTED`, `POINT_B_PLAN_APPROVED`, `POINT_B_GOAL_CORRECTED`, `POINT_B_GOAL_RESPONDED`), `lib/events/platform-names.ts` (русские названия, если там перечень), `lib/notifications/product.ts`
- Test: `tests/unit/point-b/plan-notify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  notifyPlanSubmitted(sb, input: { companyId: string; userId: string; versionId: string; authorName: string }): Promise<void>      // персонал: notifyStaff с audiencePermission 'clients.review' и approver'ам; ссылка на User 360 → Точка Б
  notifyPlanApproved(sb, input: { userId: string; versionId: string; first: boolean; actor: { id: string; name: string } }): Promise<void>   // клиенту: notifyClient (категория 'expert') + сообщение в «Сообщения» от имени одобрившего (authorKind 'staff', important: first)
  notifyGoalCorrection(sb, input: { userId: string; reviewId: string; metricLabel: string; from: number | null; to: number | null; reason: string; reviewer: { id: string; name: string } }): Promise<void>   // сообщение staff с important: true + notifyClient
  notifyGoalNeedsReview(sb, input: { userId: string; companyId: string; metricLabel: string }): Promise<void>   // персонал, когда владелец поставил/изменил цель
  ```
- Consumes: `notifyStaff` (`lib/notifications/staff.ts`), `notifyClient` (`lib/notifications/notify.ts`), `sendToUser` (`lib/comm/send.ts`, поддерживает `flags.important` после Ф1б Task 9), `trackEvent`.
- Каждая функция идемпотентна по ключу (`versionId`/`reviewId`), не бросает наружу (ошибки логируются), тексты проходят `maskProfanity`-free путь (текст формируется шаблонами, причина эксперта уже проверена на мат при вводе).

- [ ] **Step 1: Write the failing tests** (моки `notifyStaff`, `notifyClient`, `sendToUser`): `'plan submitted notifies staff with a link and never throws on failure'`; `'plan approved sends the client a notification and a staff-authored app message; first publication is important'`; `'later publications are not important'`; `'goal correction message is important and carries from/to and the reason'`; `'dedupe: the same versionId is notified once'`; `'goal needs review notifies the assigned expert, falling back to everyone with clients.review'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** функции и регистрацию событий.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): plan and goal notifications, events, expert messages`.

### Task 6: GIGA и эксперт — маршруты плана и целей; единый путь записи

**Files:**
- Create: `app/api/giga-admin/users/[id]/point-b/plan/route.ts` (GET), `…/plan/versions/route.ts` (POST создать черновик), `…/plan/versions/[versionId]/route.ts` (PATCH правка черновика), `…/plan/versions/[versionId]/submit/route.ts`, `…/approve/route.ts`, `…/reject/route.ts`, `…/plan/goals/[metricKey]/review/route.ts` (POST), `app/api/giga-admin/point-b/queue/route.ts` (GET)
- Modify: `app/api/expert/clients/[id]/point-b-version/route.ts` (POST), `app/api/giga-admin/users/[id]/point-b/route.ts` (POST), `app/api/giga-admin/users/[id]/review/point-b/route.ts` (POST) и `…/approve/route.ts` — писать/одобрять через план (создают/правят черновик `expert_notes` и отправляют на одобрение; `point_b_versions` больше не пишется)
- Test: `tests/unit/point-b/routes-plan.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `requireGiga(req, 'clients.review')`, `forbidTarget`/`guardClientAccess`, `canApprovePointB`, `recordAdminAction`, `profanityResponse`, `resolveExpert` для маршрута эксперта.
- Контракты ответов: `{ ok: true, data }` / `{ ok: false, error, reasons? }`; коды: 400 валидация/мат (с полем), 403 нет прав/не назначен/не approver, 404, 409 (`open_exists`, `not_editable`, `bad_state`, `conditions` с `reasons`).
- `approve` принимает `{ exceptionReason? }` (только approver), `reject` — `{ reason }` (≥ 5 символов); после `approve` вызывается `notifyPlanApproved` (`first` = у плана не было прежней одобренной версии), после `submit` — `notifyPlanSubmitted`; все действия пишут аудит (`point_b.plan.created|updated|submitted|approved|rejected`, `point_b.goal.reviewed`).
- Очередь: версии `in_review` по всем клиентам, видимые актёру (approver видит все; эксперт — только назначенных), с именем клиента, компанией, возрастом ожидания.

- [ ] **Step 1: Write the failing tests** (моки `requireGiga`, `guardClientAccess`, in-memory store): `'GET plan returns bundle, goal statuses and canApprove'`; `'expert of another client → 403 on every plan route'`; `'only approver can approve/reject; expert gets 403'`; `'approve with unverified primary goal → 409 with reasons'`; `'approve with exceptionReason < 10 chars → 400, ≥ 10 → 200 and the exception is audited'`; `'second concurrent approve → 409'`; `'PATCH on in_review or approved → 409'`; `'profanity in expert_notes or reason → 400 with the field'`; `'legacy POST expert/point-b-version now creates or updates a plan draft and submits it, and writes nothing to point_b_versions'`; `'legacy giga POST point-b does the same'`; `'goal review route: correct when owner has no goal sets it directly and calls notifyGoalCorrection only for proposals'`; `'queue lists in_review versions only within the actor scope'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** маршруты; общие проверки (UUID, права, область, аудит) вынести в `lib/point-b/plan/route-guard.ts` без дублирования по файлам.
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/giga-crm tests/unit/giga-admin tests/unit/expert-review` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): GIGA/expert plan routes and one write path (legacy routes go through plan versions)`.

### Task 7: Клиентские маршруты и совместимость

**Files:**
- Create: `app/api/v1/point-b/plan/route.ts` (GET), `app/api/v1/point-b/goals/[reviewId]/respond/route.ts` (POST), `lib/point-b/compat.ts`
- Modify: `app/api/v1/diagnostics/point-b/route.ts` (`expert_version` из `compat`), хук владельца цели в `app/api/v1/goals/route.ts` и `app/api/v1/goals/[id]/route.ts` (после записи цели владельцем — `notifyGoalNeedsReview`, не ломая ответ и не падая при ошибке)
- Test: `tests/unit/point-b/routes-client.test.ts`, `tests/unit/point-b/compat.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/point-b/plan` → `{ ok: true, data: { status: 'none' | 'preparing' | 'published'; version: { number: number; approvedAt: string; expertNotes: string | null; authorName: string; goals: PlanGoalsSnapshot } | null; goalReviews: Array<{ id: string; metricKey: string; metricLabel: string; status: GoalReviewStatus; from: number | null; to: number | null; reason: string | null; createdAt: string }> } }` — идентичность из сессии; `preparing` = у клиента есть цели/диагностика, но одобренной версии ещё нет.
  - `POST /api/v1/point-b/goals/:reviewId/respond { accept: boolean }` → `{ ok: true }`; не работает в режиме «от имени» (403).
  - `loadExpertVersionForClient(sb, input: { companyId: string | null; diagnosticId: string | null }): Promise<{ expert_notes: string; author_name: string; created_at: string } | null>` — одобренная версия плана; запасной вариант — последняя одобренная `point_b_versions`; `author_name` через `expertDisplayName`.
- Consumes: Tasks 3–5, `gateFeature` (Task 8 добавляет `point_b`; до этого вызывать нельзя — порядок задач: Task 8 перед этой, см. «Порядок»).

- [ ] **Step 1: Write the failing tests:** `'GET plan 401 without a session'`; `'GET plan returns none for a user without a company or plan, not 500'`; `'GET plan returns only the approved version and never a draft or in_review one'`; `'GET plan lists only this owner’s goal reviews'`; `'respond with another owner’s reviewId → 404 and no write'`; `'respond while impersonating → 403'`; `'accept applies the proposed value to metric_targets'`; `'diagnostics/point-b route returns expert_version from the approved plan, falling back to the legacy approved version'`; `'owner changing a goal triggers notifyGoalNeedsReview without changing the goals response'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/api tests/unit/goals` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): client plan routes, goal responses, expert version via compat`.

### Task 8: Гейт PRO для Точки Б (выполнить ПЕРЕД Task 7)

**Files:**
- Modify: `lib/access/entitlements.ts` (`Feature` + `point_b`, `Entitlements.point_b`, `TIER_BASE`), `lib/access/gate.ts` (текст отказа: «Точка Б доступна на тарифе Pro вместе с полным GRI и Точкой А.»), `app/api/v1/access/me/route.ts`, `hooks/useEntitlements.ts` (тип `AccessMe`), `app/api/v1/diagnostics/point-b/route.ts` и `…/ai-generate/route.ts` (вызов `gateFeature(sb, user.id, 'point_b')`), `app/(dashboard)/point-b/page.tsx` (редирект на `/client/point-b` для клиента), `app/client/point-b/page.tsx` + `components/point-b/PointBPaywall.tsx`
- Test: `tests/unit/access/point-b-gate.test.ts`

**Interfaces:**
- Produces: `entitlementsFor('free').point_b === false`, `entitlementsFor('pro').point_b === true`; `can(ent, 'point_b')`; индивидуальные переопределения (`normalizeOverrides`) принимают ключ `point_b`; `PointBPaywall` — серверно-независимая заглушка с описанием возможностей и кнопкой «Узнать о Pro» (как в существующих заглушках Sidebar).
- Поведение: при `access_gates` выключенном — как раньше (ограничений нет); включённом и `free` — API 402 `upgrade_required`, страница показывает `PointBPaywall` без данных клиента; эксперт и админ (`resolveExpert`/`requireGiga`) гейтом не затрагиваются.

- [ ] **Step 1: Write the failing tests:** `'free has no point_b, pro has'`; `'gateFeature returns 402 for free when gates are enabled'`; `'gateFeature passes when gates are disabled'`; `'override point_b true opens it for a free user'`; `'access/me exposes point_b'`; `'diagnostics/point-b returns 402 for free with gates on, 200 for pro'`; `'ai-generate is gated the same way'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; существующие тесты `tests/unit/access/*` остаются зелёными (обновить снимки, если перечисляют ключи).
- [ ] **Step 4: Run** `npx vitest run tests/unit/access tests/unit/point-b` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): PRO entitlement for Point B (server gate, paywall, /point-b redirect)`.

### Task 9: Интерфейс эксперта — план и цели

**Files:**
- Create: `components/giga-panel/user360/point-b/PlanPanel.tsx`, `components/giga-panel/user360/point-b/GoalReviewPanel.tsx`
- Modify: `components/giga-panel/user360/PointBTab.tsx` (встроить панели, убрать прямое «Сохранить корректировку»), `components/giga-panel/user360/review/PointBReview.tsx` (работа через план), `components/expert/tabs/PointBTab.tsx` (тот же поток для старого портала эксперта)
- Test: `tests/unit/point-b/PlanPanel.test.tsx`

**Interfaces:**
- Consumes: маршруты Task 6 (`GET …/plan`, `POST …/plan/versions`, `PATCH …/versions/:id`, `…/submit|approve|reject`, `…/plan/goals/:metricKey/review`).
- Поведение: список версий с бейджами статуса (`Черновик`, `На проверке`, `Одобрена`, `Заменена`); редактор заметок/причины изменений для черновика; кнопки «Отправить на одобрение» (эксперт), «Одобрить» / «Вернуть с комментарием» (только `canApprove`), диалог исключения с обязательной причиной ≥ 10 символов при невыполненных условиях (показывает `reasons`); панель целей: статус каждой цели, «Подтвердить», «Исправить» (значение, срок, причина), пометка «ждёт согласия владельца» и «оспорено»; ошибки 400/409 показываются текстом сервера.

- [ ] **Step 1: Write the failing tests** (Testing Library, `fetch` замокан): `'shows version statuses and only the actions allowed for the role'`; `'expert cannot see Approve; approver can'`; `'approve with failing conditions shows the reasons and offers the exception dialog requiring 10+ chars'`; `'goal correction form posts value, deadline and reason and shows «ждёт согласия владельца»'`; `'server error text is displayed'`; `'profanity 400 highlights the field'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** тест → PASS; `npx tsc --noEmit -p .`; eslint по файлам.
- [ ] **Step 5: Commit** `feat(point-b): expert plan and goal verification panels in User 360`.

### Task 10: Очередь админа и интерфейс клиента

**Files:**
- Create: `app/admin-giga-panel/point-b-queue/page.tsx`, `components/giga-panel/pages/PointBQueuePage.tsx`, `components/point-b/PlanStatusBanner.tsx`, `components/point-b/GoalCorrectionCard.tsx`
- Modify: `lib/admin/nav.ts` + `components/giga-panel/GigaSidebar.tsx` (пункт «Точка Б — на одобрении», право `clients.review`; тест навигации `tests/unit/giga-crm/nav*` не должен сломаться — обновить ожидание), `components/point-b/PointBContainer.tsx` (баннер статуса плана и карточки корректировок над содержимым)
- Test: `tests/unit/point-b/client-ui.test.tsx`, обновление nav-теста

**Interfaces:**
- Consumes: `GET /api/giga-admin/point-b/queue`, `GET /api/v1/point-b/plan`, `POST /api/v1/point-b/goals/:id/respond`.
- Поведение клиента: `PlanStatusBanner` показывает «Эксперт готовит план» (status `preparing`), «План v{N} одобрен {дата}» (status `published`), либо ничего (`none`); `GoalCorrectionCard` для каждой корректировки в статусе `corrected`: «Эксперт предлагает изменить цель: {from} → {to}. Причина: …» + «Согласен» / «Не согласен» (после ответа карточка закрывается); нет эксперта — понятный текст, без пустых блоков. Очередь админа: таблица (клиент, компания, версия, автор, ждёт N дней) со ссылкой на User 360 → Точка Б.

- [ ] **Step 1: Write the failing tests:** `'banner shows preparing / published / nothing by status'`; `'correction card shows from, to and reason, and posts accept/dispute then disappears'`; `'no cards and no banner for none'`; `'queue page renders rows and an empty state'`; `'nav entry visible only with clients.review'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (токены проекта, без зашитых цветов).
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/giga-crm` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): admin approval queue and client plan status / goal correction UI`.

### Task 11: Закрытие фазы

- [ ] **Step 1:** полный `npx vitest run` (допустимы только известные падения окружения), `npx tsc --noEmit -p .`, eslint по изменённым файлам.
- [ ] **Step 2:** показать PO итог и **получить слово на применение миграции 125** к проду (`cd ~/AI-Portal && node scripts/apply-migration.js <абсолютный путь к 125>`; проверить RLS и политики запросом только на чтение; запись в журнал миграций делает скрипт).
- [ ] **Step 3:** после применения — отправка в main (`git fetch origin main && git merge-base --is-ancestor origin/main HEAD`, `git push origin HEAD:main`, `git push origin HEAD`), ожидание деплоя `aistart360app-portal`, `curl` для `/api/v1/point-b/plan` (ожидается 401 без сессии) и `/admin-giga-panel/point-b-queue` (307 на вход).
- [ ] **Step 4:** обновить память проекта (`aistart360-point-b-2026-10-18.md`, `MEMORY.md`) и написать план Ф2.

## Порядок выполнения

1 → 2 → 3 → 4 → 5 → 6 → **8** → 7 → 9 → 10 → 11 (Task 8 до Task 7: клиентские маршруты используют гейт). Task 5 использует флаг `important` из Ф1б Task 9 — Ф1б должна быть закоммичена раньше.

## Self-Review (выполнено)

- **Покрытие спеки Ф1:** миграция (T1); поток черновик→проверка→одобрение→публикация (T2–T3, T6); верификация целей и согласование (T4, T6, T7, T10); условия одобрения и исключение админа (T2, T6); права и аудит (T6); уведомления клиенту и персоналу, сообщение эксперта (T5); один путь записи (T6); клиент видит только одобренное (T7); гейт PRO (T8); очередь «Клиенты без плана» — **не в Ф1**: нужна при расчёте уровней, уходит в Ф2 (в Ф1 есть очередь «на одобрении»); напоминания 7/14 дней и кроны — Ф6 (в Ф1 есть `applyStaleCorrection` и `reminded_at`).
- **Типы:** `PlanGoalsSnapshot`/`GoalReviewStatus` (T2) используются в T3, T4, T7; `PlanError` (T3) в T6–T7; `notify*` (T5) в T6–T7; `important` согласован с Ф1б.
- **Review Focus:** условия одобрения/исключение (T2, T6), гонка и supersede (T3, T6), неизменяемость и один открытый (T1, T3, T6), чужие клиенты и `reviewId` (T6, T7), пустые состояния и гейт (T7, T8).
- **Пропорции:** задачи содержат сигнатуры, правила и названия тестов; тел функций нет.
