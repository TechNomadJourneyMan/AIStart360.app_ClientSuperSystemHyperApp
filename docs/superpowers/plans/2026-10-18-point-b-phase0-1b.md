# Точка Б — Ф0 (основа и исправления) и Ф1б (всплывающий слой): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Свести все потребители Точки Б к одному источнику данных (снимок Точки А v4, корректная база выручки с периодом), закрыть пути автоодобрения экспертных версий и добавить глобальный всплывающий слой кабинета клиента с сообщениями эксперта.

**Architecture:** Ф0 — рефакторинг и исправления вокруг существующего чистого движка `lib/point-b/engine.ts`: новый загрузчик `lib/point-b/inputs.ts` читает диагностику, снимок v4, анкету, GRI, метрики и цели один раз, движок получает признаки «блок без данных» и «база устарела». Ф1б — отдельный слой `lib/popups/*` (чистый отбор + доступ к `comm_messages`) и компонент `components/popups/PopupLayer.tsx` в `app/client/layout.tsx`; новых таблиц и миграций нет (состояние показа — в `comm_messages.metadata.popup`, флаг «важное» — в `comm_messages.flags.important`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service client, Realtime), Vitest (+ Testing Library для UI), Zod.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§4 аудит, §6 процесс, §12.2 всплывающий слой, §19 миграция, §21 Ф0/Ф1б). Планы Ф1–Ф6 пишутся отдельными файлами в начале каждой фазы (как для Точки А).

## Global Constraints

- Не трогать «Гри»: `lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`, `app/(dashboard)/dashboard/page.tsx` (его копия `diagToPointA` не меняется).
- Не удалять компоненты, отклонённые PO: `CRMConnectModal`, `MetricBlockV3`, `PointAInsightCard`, `MarketGenerateButton`. Старый движок `lib/point-b-engine.ts`, `app/api/clients/[id]/analysis/point-b`, `app/(dashboard)/clients/[id]/point-b`, `tests/unit/point-b/s9n-keys.test.ts` **не удаляются** (V2).
- Локальный `.env` указывает на **продовую БД**: не запускать dev-сервер, не писать скриптами в БД, миграции не применять. Тесты не обращаются к сети и БД (моки как в `tests/unit/comm/_db.ts`).
- Нет данных → честное «данных не хватает», никаких тихих нулей и выдуманных цифр.
- Клиент видит только одобренную экспертом версию; экспертная версия не публикуется без одобрения Admin/Super Admin.
- UI-тексты на русском; дизайн — на токенах проекта, без жёстко зашитых цветов (PO заменит оформление).
- Фильтр мата (`lib/moderation`) на любые тексты, которые вводят люди.
- Каждая задача: `npx tsc --noEmit -p .` и `npx eslint` по затронутым файлам чистые, тесты зелёные, отдельный коммит; в конце фазы — полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), `whatsapp-web-bridge-reliability`) и отправка в main.
- В конце каждого коммита: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Клиент без диагностики, без снимка или со снимком `engine: 'v1'` → Точка Б отдаёт «нет данных», а не падает и не рисует нулевые блоки.
- Единственная выручка за прошлый год (напр. 2024) → база помечена устаревшей, а не используется молча как «текущая».
- Эксперт открывает Точку Б клиента, который ему не назначен → 403 на всех маршрутах Точки Б (расчёт, версия, одобрение).
- Всплывающий слой при режиме «от имени» (impersonation) и у пользователя без диалога (`comm_threads` ещё нет) → молчит, ничего не пишет, не падает.
- Сообщение эксперта приходит, пока пользователь печатает или на `/client/messages` → не теряется и не открывается поверх; бот/рассылка (`author_kind` ≠ `staff`) никогда не становятся окном и не ставят флаг «важное».

---

## File Structure

| Файл | Ответственность |
|---|---|
| `lib/point-b/adapters.ts` (new) | `diagToPointA`, `mapGriTop5` — единственные копии (экспортируются, `lib/admin/expert-client-data.ts` реэкспортирует) |
| `lib/point-b/inputs.ts` (new) | `loadPointBInputs` — всё, что нужно движку, одним вызовом |
| `lib/point-b/compute.ts` (new) | `computePointB(inputs)` — вызов движка с входами загрузчика |
| `lib/point-b/engine.ts` (modify) | `PointBOptions.blocksWithoutData`, `baseRevenue`; `PointBV2.data_quality`; реалистичность не штрафует блоки без данных |
| `lib/point-b/versions.ts` (new) | `saveExpertVersionDraft` — единый путь записи экспертной версии (`is_approved: false`) |
| `app/api/v1/diagnostics/point-b/route.ts`, `…/ai-generate/route.ts`, `app/api/expert/clients/[id]/point-b/route.ts`, `app/api/giga-admin/users/[id]/point-b/route.ts`, `lib/share/report-data.ts`, `app/api/export/report/route.ts` (modify) | перейти на загрузчик |
| `app/api/expert/clients/[id]/point-b-version/route.ts`, `app/api/giga-admin/users/[id]/point-b/route.ts` POST (modify) | запись через `saveExpertVersionDraft` |
| `components/giga-panel/user360/PointBTab.tsx`, `components/expert/tabs/PointBTab.tsx` (modify) | текст «отправлено на одобрение» |
| `app/dev/point-b-preview/page.tsx`, `lib/point-b/fixtures.ts` (new) | read-only страница на фикстуре для визуального аудита |
| `lib/popups/types.ts`, `select.ts`, `store.ts` (new) | типы, чистый отбор окон, доступ к данным |
| `app/api/v1/popups/route.ts`, `app/api/v1/popups/[id]/route.ts` (new) | `GET`, `PATCH` |
| `app/api/giga-admin/comm/users/[userId]/messages/route.ts`, `lib/comm/send.ts`, `components/giga-panel/comm/Conversation.tsx` (modify) | флаг «важное» |
| `components/popups/PopupLayer.tsx`, `PopupCard.tsx`, `PopupModal.tsx`, `usePopups.ts` (new); `app/client/layout.tsx` (modify, одна строка) | клиентский слой |
| `lib/settings/registry.ts` (modify) | `pb_popups_enabled`, `pb_popup_cards_per_day` |

---

## Ф0. Основа и исправления

### Task 1: Единые адаптеры и загрузчик входов Точки Б

**Files:**
- Create: `lib/point-b/adapters.ts`, `lib/point-b/inputs.ts`
- Modify: `lib/admin/expert-client-data.ts` (убрать локальные `diagToPointA`/`mapGriTop5`, реэкспортировать из `adapters.ts`)
- Test: `tests/unit/point-b/inputs.test.ts`

**Interfaces:**
- Produces:
  - `diagToPointA(diag: Record<string, unknown>): PointA`, `mapGriTop5(raw: unknown): PointBOptions['griTop5']` (поведение — как сейчас в `lib/admin/expert-client-data.ts`).
  - ```ts
    export interface PointBInputs {
      userId: string
      companyId: string | null
      diagnostic: Record<string, unknown> | null        // diagnostics is_current row
      snapshot: { id: string; engine: 'v1' | 'v4'; confidence: number | null; coverage: number | null; createdAt: string } | null
      blocksWithoutData: string[]                        // BlockKey of v4 blocks with score === null ('finance' | 'sales' | ...)
      pointA: PointA | null
      answers: Record<string, unknown>
      griTop5: PointBOptions['griTop5']
      metricOptions: Pick<PointBOptions, 'currentRevenueYear' | 'metrics'>
      goal12mYear: number | null
      goal3yYear: number | null
      base: { revenue: number | null; period: string | null; ageMonths: number | null; stale: boolean }
    }
    export async function loadPointBInputs(client: SupabaseClient, userId: string, opts?: { companyId?: string | null }): Promise<PointBInputs>
    ```
- Consumes: `pointAFromDiagnosticRow`-подобные колонки `diagnostics`, `point_a_snapshots` (последняя строка компании по `created_at desc`), `loadPointBMetricOptions` (`lib/point-b/metrics.ts`), `loadGoals` из `lib/goals/store.ts` (цели `metric_targets` по метрике `biz.finansy.vyruchka_god`, периоды `12m` / `3y`) с запасным чтением `companies.target_revenue_*`.

- [ ] **Step 1: Write the failing test** `tests/unit/point-b/inputs.test.ts` с in-memory моком клиента Supabase. Тесты:
  - `'reads the v4 snapshot and lists blocks without data'`: снимок `engine: 'v4'`, блок `sales.score = null` → `blocksWithoutData` равен `['sales']`, `snapshot.engine === 'v4'`.
  - `'a v1 snapshot or no snapshot gives no blocksWithoutData and snapshot null for none'`: нет снимка → `snapshot === null`, `blocksWithoutData` пуст; нет диагностики → `pointA === null`.
  - `'goals come from metric_targets, falling back to companies.target_revenue_*'`.
  - `'base period: revenue 2024 with now 2026-10-18 is stale (ageMonths > 15)'`, `'revenue of the current year is not stale'`, `'no revenue → base.revenue null, stale false'`.
  - `'diagToPointA keeps a block as null-safe: missing column gives an empty block, never throws'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/inputs.test.ts` → FAIL (модуль не найден).
- [ ] **Step 3: Implement** `adapters.ts` (перенос функций без смены поведения) и `inputs.ts`: период базы берётся из `snapshot.inputs.metrics['biz.finansy.vyruchka_god'].period` (формат — `lib/data-layer/period-key.ts`), возраст в месяцах считается от конца периода до `new Date()`; `stale = ageMonths > 15`. Один раунд `Promise.all` для независимых чтений; ошибка чтения снимка/метрик логируется и даёт пустые значения (как в `loadPointBMetricOptions`).
- [ ] **Step 4: Run** тот же тест → PASS; `npx vitest run tests/unit/giga-crm tests/unit/point-b` → PASS (реэкспорт не сломал вкладки эксперта).
- [ ] **Step 5: Commit** `refactor(point-b): one adapters module and loadPointBInputs (snapshot v4, goals, revenue base with period)`.

### Task 2: Движок — блок «нет данных» не слабый, база с признаком давности

**Files:**
- Modify: `lib/point-b/engine.ts` (`PointBOptions`, `PointBV2`, `assessRealism`, `calculatePointBV2`)
- Create: `lib/point-b/compute.ts`
- Test: `tests/unit/point-b/engine.test.ts` (дополнить), `tests/unit/point-b/compute.test.ts`

**Interfaces:**
- Produces:
  - В `PointBOptions`: `blocksWithoutData?: string[]`, `baseRevenue?: { period: string | null; ageMonths: number | null; stale: boolean }`.
  - В `PointBV2`: `data_quality: { blocks_without_data: string[]; base: { period: string | null; age_months: number | null; stale: boolean }; snapshot: { id: string; confidence: number | null; coverage: number | null } | null }`.
  - `computePointB(inputs: PointBInputs): PointBV2 | null` (null, если нет диагностики) в `lib/point-b/compute.ts`: вызывает `calculatePointBV2(inputs.pointA, inputs.answers, { diagnosticId, griTop5, ...inputs.metricOptions, goal12mYear, goal3yYear, blocksWithoutData, baseRevenue: inputs.base })` и записывает `data_quality`.
- Consumes: `PointBInputs` из Task 1.

- [ ] **Step 1: Write the failing tests** в `engine.test.ts`:
  - `'blocks without data do not count as weak and do not lower realism'`: два блока с `score 0`, но в `blocksWithoutData` → `realism.weak_blocks` их не содержит, уровень реалистичности не понижен.
  - `'a block with a real score under 50 is still weak'` (регрессия).
  - `'blocks_without_data is echoed in data_quality'`, `'stale base adds a risk factor and a rationale line mentioning the base period'`, `'fresh base adds none'`.
  - В `compute.test.ts`: `'computePointB returns null without a diagnostic'`; `'passes snapshot confidence and coverage into data_quality'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b` → новые тесты FAIL.
- [ ] **Step 3: Implement.** В `assessRealism` слабые блоки по баллам считать только среди блоков, которых нет в `blocksWithoutData`; при `stale` добавить в `rationale` строку «Выручка взята за {период} — данные устарели, оценка приблизительна» и в `risk_factors` соответствующее предупреждение (тексты русские, без смены уровня). `data_quality` заполняется всегда.
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b` → PASS, включая прежние 29 тестов движка.
- [ ] **Step 5: Commit** `fix(point-b): blocks without data are not weak; stale revenue base is flagged; data_quality in the result`.

### Task 3: Клиентский, AI, GIGA и экспертный маршруты — на загрузчик

**Files:**
- Modify: `app/api/v1/diagnostics/point-b/route.ts`, `app/api/v1/diagnostics/point-b/ai-generate/route.ts`, `app/api/giga-admin/users/[id]/point-b/route.ts` (GET), `app/api/expert/clients/[id]/point-b/route.ts`
- Test: `tests/unit/point-b/routes-read.test.ts`

**Interfaces:**
- Consumes: `loadPointBInputs`, `computePointB` (Tasks 1–2). Остальное поведение ответов сохраняется (поля `data`, `reason`, `expert_version`, `version`), добавляется `data.data_quality`.

- [ ] **Step 1: Write the failing tests** `routes-read.test.ts` (моки `createServerClient`, `createServiceClient`, `resolveExpert`, `requireGiga`, `guardClientAccess`):
  - `'client route: 401 without a session'`, `'client route: reads only the session user, ignores a user_id query'`.
  - `'expert route no longer queries metrics?metric_key=eq.revenue'`: клиент с выручкой в реестре метрик получает `pointB.gap` с заполненной выручкой (раньше «недостаточно данных»).
  - `'giga route: 403 for an actor without access to the client (guardClientAccess)'`.
  - `'expert route: a client not assigned to the expert gets 403'` (использовать существующий механизм назначения в `resolveExpert`/`lib/expert-auth`; если у `resolveExpert` нет проверки назначения — добавить её и тест).
  - Все четыре маршрута возвращают `data_quality.base.stale === true` для выручки 2024.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — заменить локальные копии `diagToPointA`/`mapGriTop5` и запросы выручки/целей вызовами загрузчика; в клиентском маршруте сохранить запись `point_b_analysis` и слияние AI-полей, как сейчас. В `ai-generate` оставить логику AI без изменений, сменить только источник входов.
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/api tests/unit/giga-admin` → PASS.
- [ ] **Step 5: Commit** `fix(point-b): client, AI, GIGA and expert routes read one loader (expert no longer sees «недостаточно данных» with filled revenue)`.

### Task 4: Публичная ссылка и экспорт — на загрузчик

**Files:**
- Modify: `lib/share/report-data.ts` (чтение выручки около строки 360 и копии `diagToPointA`/`mapGriTop5`), `app/api/export/report/route.ts`
- Test: `tests/unit/point-b/share-export.test.ts`

**Interfaces:** Consumes `loadPointBInputs`, `computePointB`; публичные формы ответа `share/report-data` и PDF не меняются.

- [ ] **Step 1: Write the failing tests:** `'share report data computes Point B from the loader (revenue from registry metrics, not metrics.revenue)'`; `'export report passes a stale base note into the Point B section data'`; `'a client without a diagnostic yields a report with pointB: null and no throw'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Прямые запросы к `metrics?metric_key=eq.revenue` удалить. Сервис-клиент для публичной ссылки остаётся как есть (она работает без сессии по токену); `userId` берётся из записи токена.
- [ ] **Step 4: Run** `npx vitest run tests/unit/share tests/unit/point-b tests/unit/api` → PASS.
- [ ] **Step 5: Commit** `fix(point-b): share link and PDF export use the same inputs as the page`.

### Task 5: Закрыть пути автоодобрения экспертной версии

**Files:**
- Create: `lib/point-b/versions.ts`
- Modify: `app/api/expert/clients/[id]/point-b-version/route.ts` (POST), `app/api/giga-admin/users/[id]/point-b/route.ts` (POST), `components/giga-panel/user360/PointBTab.tsx`, `components/expert/tabs/PointBTab.tsx`
- Test: `tests/unit/point-b/versions.test.ts`

**Interfaces:**
- Produces: `saveExpertVersionDraft(sb: SupabaseClient, input: { diagnosticId: string; authorId: string; authorName: string; notes: string; roadmap?: unknown }): Promise<{ id: string; is_approved: false; created_at: string }>` — вставка в `point_b_versions` с `is_approved: false`.
- Consumes: существующие маршруты `review/point-b` и `…/approve` остаются единственным путём одобрения (Admin / Super Admin).

- [ ] **Step 1: Write the failing tests:**
  - `'saveExpertVersionDraft inserts is_approved false'`.
  - `'POST expert point-b-version creates an unapproved version and the client route does not return it'`.
  - `'POST giga point-b creates an unapproved version'`, `'profanity in notes → 400 with field expert_notes (unchanged)'`.
  - `'client route returns only is_approved true versions'` (регрессия).
  - `'only admin or super admin can approve (existing approve route) — expert gets 403'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** helper и подключить к двум маршрутам; в обеих вкладках интерфейса заменить текст успешного сохранения на «Корректировка отправлена на одобрение старшим экспертом. Клиент увидит её после одобрения», а в GIGA-вкладке показывать статус последней версии («ждёт одобрения / одобрена»).
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/giga-crm tests/unit/giga-admin` → PASS.
- [ ] **Step 5: Commit** `fix(point-b): expert corrections are drafts until Admin approval (closes the auto-approve paths)`.

### Task 6: Фикстура и страница для визуального аудита

**Files:**
- Create: `lib/point-b/fixtures.ts`, `app/dev/point-b-preview/page.tsx`, `docs/superpowers/specs/2026-10-18-point-b-visual-audit.md`
- Test: `tests/unit/point-b/fixtures.test.ts`

**Interfaces:**
- Produces: `fixturePointB(variant: 'full' | 'no-goal' | 'stale-base'): PointBV2` — детерминированная фикстура для `PointBView`; страница `/dev/point-b-preview?variant=…` рендерит `PointBView` на ней (read-only, без БД, повторяя защиту `app/dev/point-a-preview`: недоступна на проде).
- Consumes: `PointBView` (`components/point-b/PointBView.tsx`).

- [ ] **Step 1: Write the failing test:** `'every variant is a valid PointBV2 (gap, trajectory, scenarios, horizons present; no NaN)'`, `'no-goal variant has data_sufficiency.complete false'`, `'the preview page is not served in production (NODE_ENV production → notFound)'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** фикстуру и страницу (по образцу `app/dev/point-a-preview`).
- [ ] **Step 4: Run** тест → PASS. Затем визуальный аудит: `preview_start` dev-сервера (только `/dev/point-b-preview`, к БД и API **не** обращаться), скриншоты desktop и mobile для трёх вариантов; записать находки в `2026-10-18-point-b-visual-audit.md` в формате таблицы §4 спеки (элемент → проблема → улучшение → приоритет), отдельно «найдено на экране» и «предположение».
- [ ] **Step 5: Commit** `feat(point-b): read-only preview fixture and visual audit notes`.

---

## Ф1б. Всплывающий слой (сообщения эксперта)

### Task 7: Чистый отбор окон

**Files:**
- Create: `lib/popups/types.ts`, `lib/popups/select.ts`
- Test: `tests/unit/popups/select.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PopupKind = 'expert_message' | 'recommendation' | 'insight'
  export interface PopupCandidate {
    id: string                       // comm_messages.id для expert_message
    kind: PopupKind
    display: 'card' | 'modal'
    priority: number                 // меньше = важнее
    title: string; body: string
    authorName: string | null; authorSpecialty: string | null
    createdAt: string
    href: string | null              // глубокая ссылка
    important: boolean               // флаг эксперта
    canReply: boolean
  }
  export interface PopupState { id: string; seenAt?: string; dismissedAt?: string; snoozedUntil?: string }
  export interface PopupRules { cardsPerDay: number; modalPerDay: number; messageWindowDays: number }
  export interface PopupContext { now: Date; pro: boolean; impersonating: boolean; doNotDisturbUntil: string | null; route: string; shownToday: { cards: number; modals: number } }
  export function selectPopups(candidates: PopupCandidate[], states: Record<string, PopupState>, ctx: PopupContext, rules: PopupRules): PopupCandidate[]
  ```
- Правила (из спеки §12.2): сообщения эксперта — без суточных лимитов, но не старше `messageWindowDays` (3); `display: 'modal'` только если `important` (для `expert_message`), не более `modalPerDay` (1) в сутки, исключение — `important` с требованием ответа не режется модальным лимитом; рекомендации и инсайты — только `pro`, не более `cardsPerDay` (3) в сутки; `impersonating` → пустой результат; `doNotDisturbUntil` в будущем гасит всё, кроме сообщений эксперта; маршруты `/client/messages`, `/client/onboarding*`, `/client/survey*`, `/login`, `/register`, `/client/waiting-room` — пусто; уже `dismissedAt` / `seenAt` (для карточки) / `snoozedUntil` в будущем — исключаются; сортировка по `priority`, затем по `createdAt` убывающе.

- [ ] **Step 1: Write the failing tests** (все с фиксированным `now`): `'expert message is shown without daily caps'`; `'bot/system authored candidates never reach select (type excludes them)'` (кандидат строится только из `author_kind='staff'` — проверяется в Task 8, здесь `kind`-правила); `'modal only for important messages and at most once a day'`; `'important message requiring reply still shows when the modal cap is spent, as a card'`; `'recommendations and insights are hidden without pro'`; `'cards per day cap of 3 applies to recommendations and insights, not messages'`; `'impersonating returns empty'`; `'do-not-disturb hides insights but not expert messages'`; `'suppressed routes return empty'`; `'dismissed, snoozed and already seen candidates are excluded'`; `'ordering: reply-required message, expert message, recommendation, insight'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/popups/select.test.ts` → FAIL.
- [ ] **Step 3: Implement** `selectPopups` как чистую функцию без IO.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(popups): pure selection of pop-ups (priority, caps, suppression rules)`.

### Task 8: Доступ к данным и маршруты `GET/PATCH /api/v1/popups`

**Files:**
- Create: `lib/popups/store.ts`, `app/api/v1/popups/route.ts`, `app/api/v1/popups/[id]/route.ts`
- Test: `tests/unit/popups/routes.test.ts` (с `tests/unit/comm/_db.ts`)

**Interfaces:**
- Produces:
  - `loadExpertMessageCandidates(sb: SupabaseClient, userId: string, now: Date, windowDays: number): Promise<{ threadId: string | null; candidates: PopupCandidate[]; states: Record<string, PopupState> }>` — исходящие сообщения `author_kind = 'staff'`, `channel = 'app'`, `direction = 'out'`, не старше окна, только пока `comm_threads.unread_user > 0`; `states` из `comm_messages.metadata.popup`; `important` из `flags.important === true`; `display` = `modal` для important.
  - `markPopup(sb, userId, messageId, action: 'seen' | 'dismiss' | 'snooze' | 'acted', opts?: { days?: 3 | 7 | 30 }): Promise<boolean>` — пишет `metadata.popup` сообщения **только** если оно принадлежит диалогу этого пользователя.
  - `GET /api/v1/popups` → `{ ok: true, data: { threadId, popups: PopupCandidate[] } }` (пустой список при отсутствии диалога, режиме «от имени», выключенной настройке `pb_popups_enabled`); `PATCH /api/v1/popups/:id` `{ action, days? }` → `{ ok: true }`.
- Consumes: `selectPopups` (Task 7), `activeImpersonation` (`lib/impersonation/server`), настройки через `lib/settings`, `createServerClient` для идентичности, сервис-клиент для чтения/записи, `shownToday` считается из `metadata.popup.seenAt` за сутки.

- [ ] **Step 1: Write the failing tests:**
  - `'GET 401 without a session'`; `'GET returns [] for a user without a thread'`; `'GET returns [] while impersonating'`.
  - `'GET returns a staff message of the user’s thread and never a bot or system message'`; `'GET never returns another user’s messages'`.
  - `'GET returns [] when unread_user is 0'`.
  - `'important flag makes display modal'`; `'a message with flags.important from a bot author is not important'` (флаг игнорируется, если автор не `staff`).
  - `'PATCH dismiss writes metadata.popup.dismissedAt and the message is no longer returned'`; `'PATCH on a message of another thread → 404 and no write'`; `'PATCH snooze with days 7 sets snoozedUntil'`, `'PATCH rejects days outside 3|7|30 with 400'`.
  - `'PATCH is refused while impersonating (403)'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/popups` → FAIL.
- [ ] **Step 3: Implement** store и маршруты; чтение — два коротких запроса (диалог + последние сообщения), запись — один `update` строки; идентичность только из сессии, `id` из URL проверяется на принадлежность диалогу.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(popups): GET/PATCH /api/v1/popups for expert messages`.

### Task 9: Флаг «важное / требует ответа» при отправке из «Сообщений»

**Files:**
- Modify: `app/api/giga-admin/comm/users/[userId]/messages/route.ts`, `lib/comm/send.ts` (передача `flags`), `lib/comm/types.ts` при необходимости, `components/giga-panel/comm/Conversation.tsx`
- Test: `tests/unit/comm/routes.test.ts` (дополнить)

**Interfaces:**
- Produces: тело `POST …/messages` принимает `important?: boolean`; `sendToUser({ …, flags?: { important?: boolean } })` записывает `flags.important = true` в строку(и) `comm_messages` канала `app`. Доступ — как у отправки (`inbox.manage`).
- Consumes: Task 8 читает `flags.important`.

- [ ] **Step 1: Write the failing tests:** `'important true is stored in flags.important of the app message'`; `'important is ignored for non-staff authors'`; `'missing important keeps flags {}'`; `'profanity check and permissions are unchanged'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/comm` → FAIL.
- [ ] **Step 3: Implement** + чекбокс «Важное — показать окном, требует ответа» в форме отправки (`Conversation.tsx`), по умолчанию выключен.
- [ ] **Step 4: Run** `npx vitest run tests/unit/comm` → PASS.
- [ ] **Step 5: Commit** `feat(comm): «важное» flag on staff messages (drives the modal pop-up)`.

### Task 10: Клиентский слой `PopupLayer`

**Files:**
- Create: `components/popups/PopupLayer.tsx`, `components/popups/PopupCard.tsx`, `components/popups/PopupModal.tsx`, `components/popups/usePopups.ts`
- Modify: `app/client/layout.tsx` (добавить `<PopupLayer />` рядом с `MascotLauncher`, не меняя его), `lib/settings/registry.ts` (`pb_popups_enabled` по умолчанию `true`, `pb_popup_cards_per_day` по умолчанию `3`, группа «Точка Б»)
- Test: `tests/unit/popups/PopupLayer.test.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/v1/popups` (Task 8), `POST /api/v1/comm/messages` (быстрый ответ), Realtime-подписка на `comm_messages` по `thread_id` (образец — `components/client/messages`).
- `usePopups(): { popups: PopupCandidate[]; dismiss(id): Promise<void>; snooze(id, days: 3 | 7 | 30): Promise<void>; markSeen(id): Promise<void>; reply(id, body: string): Promise<void> }` — запрос при монтировании и при смене маршрута не чаще раза в 60 с; запасной опрос раз в 120 с только при `document.visibilityState === 'visible'`; новое сообщение по Realtime добавляет окно без опроса.

- [ ] **Step 1: Write the failing tests** (Testing Library, `fetch` и Realtime замоканы):
  - `'shows one card at a time with the author name and a preview'`.
  - `'a new message via Realtime appears without a reload'`.
  - `'does not open anything during the first 5 seconds after load'` (fake timers).
  - `'defers the window while a text field is focused and shows it after blur'` (окно не теряется).
  - `'does not render on /client/messages and /client/onboarding'`.
  - `'quick reply posts to /api/v1/comm/messages, then dismisses the card'`.
  - `'modal traps focus, Esc closes it, focus returns to the previous element'`.
  - `'snooze buttons offer 3 / 7 / 30 days and call PATCH with the days'`.
  - `'renders nothing and makes no writes when the API returns an empty list or an error'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/popups/PopupLayer.test.tsx` → FAIL.
- [ ] **Step 3: Implement** слой: позиционирование так, чтобы не перекрывать `MascotLauncher` (отступ от правого нижнего угла под виджет Гри, на телефоне — нижняя «шторка» над навигацией); `aria-live="polite"` для карточек, `role="dialog"` + `aria-modal` для модального; `prefers-reduced-motion` отключает анимацию; цвета и отступы — токены проекта.
- [ ] **Step 4: Run** тест → PASS; затем `npx tsc --noEmit -p .`, `npx eslint components/popups app/client/layout.tsx lib/popups app/api/v1/popups`.
- [ ] **Step 5: Commit** `feat(popups): client pop-up layer (cards, modal for important, quick reply) on every cabinet page`.

### Task 11: Закрытие фаз

- [ ] **Step 1:** полный `npx vitest run`; допустимы только известные падения окружения (см. Global Constraints); `npx tsc --noEmit -p .` и `npx eslint` по изменённым файлам чистые.
- [ ] **Step 2:** `git fetch origin main && git merge-base --is-ancestor origin/main HEAD`, затем `git push origin HEAD:main` и `git push origin HEAD`; дождаться деплоя `aistart360app-portal` (`vercel inspect portal.aistart360.app`), проверить `curl -s -o /dev/null -w "%{http_code}"` для `/` и `/api/v1/popups` (ожидается 401 без сессии).
- [ ] **Step 3:** обновить память проекта: `aistart360-point-b-2026-10-18.md` (решения PO, статус Ф0/Ф1б) и строку в `MEMORY.md`.

---

## Фазы после Ф1б (отдельные планы пишутся в начале каждой)

Ф1 (данные и процесс плана, миграция 125), Ф2 (модель уровней 0–1, сценарии, «Обзор» и «Сценарии»), Ф3 (финмодель и денежный поток), Ф4 («Что если»), Ф5 (стратегия и дорожная карта), Ф6 (ИИ, пересчёт 2×/нед, план-факт, инвайты, сравнение версий) — состав, критерии готовности и порядок зафиксированы в §21 спеки. Миграции применяются к проду только после зелёных тестов фазы и вашего слова.

## Self-Review (выполнено)

- **Покрытие спеки (Ф0 и Ф1б):** единый загрузчик и снимок v4 (T1, T2); «нет данных» ≠ слабый блок (T2); база выручки с периодом и починка expert/share/export (T3, T4); автоодобрение (T5); визуальный аудит на фикстуре (T6); слой §12.2: приоритеты, лимиты, подавление, быстрый ответ, модальное для важного, Realtime, мобильная шторка, доступность, «Гри» не меняется (T7–T10). Не в этом плане, но в спеке: адаптер совместимости `lib/point-b/compat.ts` — нужен только с Ф1 (когда появятся версии плана), поэтому уходит в план Ф1.
- **Типы:** `PointBInputs` (T1) используется в T2–T4 с теми же полями; `PopupCandidate`/`PopupState`/`PopupContext` (T7) — в T8 и T10; `important` и `flags` согласованы между T8 и T9.
- **Review Focus:** каждое из пяти покрыто тестами: v1/нет снимка (T1), устаревшая база (T1, T2, T3), чужой клиент (T3, T5), impersonation и отсутствие диалога (T8), печатает / `/client/messages` / бот и рассылка (T7, T8, T10).
