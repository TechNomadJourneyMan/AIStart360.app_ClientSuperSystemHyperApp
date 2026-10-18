# Точка Б — Ф4 (лаборатория «Что если», 6 калькуляторов): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиент (PRO) двигает параметры — маркетинг, найм, средний чек, конверсию, падение выручки, постоянные расходы — и сразу видит, как меняются выручка к сроку, срок достижения цели, касса, кассовый разрыв и потребность в финансировании; может сохранить сценарий, сбросить, посмотреть допущения и **предложить его эксперту** для включения в план.

**Architecture:** Чистая функция `runWhatIf` (`lib/point-b/model/whatif.ts`) пересчитывает **полную** модель (воронка + денежный поток Ф2/Ф3) от базового «текущего хода» с изменёнными **входами** (не выходами) — никакого суммирования независимых эффектов; вклад каждого изменения оценивается отдельным прогоном, совместный — общим (показывается эффект взаимодействия). Маршруты ничего не пишут в план: только расчёт и сохранённые «что если» клиента (`pb_saved_scenarios`, миграция 127). «Предложить в план» отправляет эксперту сообщение в «Сообщения» (входящее клиента) и ставит отметку, а правку плана делает только эксперт.

**Tech Stack:** TypeScript, Next.js 14, Supabase (service client, RLS), Zod, Vitest, SVG без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§9.5 «Что если», §10 таблица калькуляторов, §6 видимость, §15). Предыдущие планы Ф0–Ф3 должны быть в main.

## Global Constraints

- Те же ограничения, что в планах Ф1–Ф3: не трогать «Гри» (`lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`); не удалять отклонённые PO компоненты и старый движок; не трогать реестр метрик, анкету и `lib/point-a/**`; локальный `.env` = **продовая БД**: без dev-сервера и записывающих скриптов, **миграцию 127 применяет ведущий при отправке в main** (слово PO получено); тесты без сети и БД; UI на русском на токенах проекта (без зашитых цветов, PO заменит дизайн); фильтр мата на имя сценария и комментарий; `tsc`, `eslint`, тесты зелёные; отдельный коммит на задачу с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; перед отправкой полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), редкий таймаут интеграционных `point-a-aggregate` / `metrics-resolver`).
- Параметры «что если» — это **дельты входов**; каждый запуск пересчитывает всю модель от базового профиля; пустой набор изменений даёт `changed = baseline` ровно (тест). Сумма вкладов + эффект взаимодействия = совместное изменение (тест).
- **Никаких выдуманных чисел:** допущения калькуляторов (эффективность маркетинга 0,7, эластичность спроса по чеку 0,3, эффект найма на выручку 0) — явные параметры с диапазонами, всегда перечисляются в `assumptions` результата; нет входа (CAC, численность, финмодель) → калькулятор помечен `applicable.ok = false` с причиной или считает без денег (поле `null` + пометка), а не подставляет число.
- Видимость (спека §6): «что если» доступен клиенту PRO с уровня 1 в любой момент, с пометкой «расчёт на ваших данных, не рекомендация»; **ничего не меняет в плане**; сохранённые сценарии видит только владелец (и персонал); предложение эксперту — только владелец, не в режиме «от имени».
- Расчёт детерминирован, время — параметром; результат не содержит NaN/Infinity (JSON round-trip безопасен); лимит частоты расчёта — 60 запросов за 10 минут на пользователя; сохранённых сценариев — не более 20 на компанию, имя ≤ 80 символов, комментарий ≤ 500.

## Review Focus

- Клиент без воронки (упрощённая модель роста) → калькуляторы «маркетинг», «чек», «конверсия» недоступны с понятной причиной, «падение выручки» и «постоянные расходы» работают; клиент уровня 0 → вкладка объясняет, чего не хватает, а не пустой экран.
- Экстремальные значения (маркетинг −100% / +500%, чек −90%, конверсия выше 100% или ниже 0, срок старта больше горизонта, найм 0 и 1000 человек) → валидация с текстом и поле, не NaN и не падение.
- Два изменения вместе (например чек + конверсия) не считаются дважды: совместный результат совпадает с одним полным прогоном, а `sum(вклады) + взаимодействие = совместное`.
- Чужие сохранённые сценарии и сценарии другой компании → 404; сохранение/предложение в режиме «от имени» и без PRO → отказ; расчёт не пишет в БД (кроме сохранения по явной кнопке).
- Предложение эксперту без назначенного эксперта / без диалога → сообщение всё равно попадает в диалог пользователя (без падения), повторное предложение того же сценария не дублирует сообщение.

---

## Контракты

```ts
// lib/point-b/model/whatif.ts (экспорт и типы; `types.ts` не меняется)
export type WhatIfKind = 'marketing' | 'hire' | 'avg_check' | 'conversion' | 'revenue_shock' | 'fixed_costs'
export type WhatIfChange =
  | { kind: 'marketing'; budgetPct: number /* −50..+100 */; efficiency?: number /* 0.3..1, по умолчанию 0.7 */ }
  | { kind: 'hire'; count: number /* 1..20 */; startMonth: number /* 1..H */; revenueEffectPct?: number /* 0..1 выручки на сотрудника, по умолчанию 0 */ }
  | { kind: 'avg_check'; pct: number /* −30..+50 */; demandElasticity?: number /* 0..1, по умолчанию 0.3 */ }
  | { kind: 'conversion'; pp: number /* −10..+20 п.п. */ }
  | { kind: 'revenue_shock'; pct: number /* −60..0 */; startMonth: number; durationMonths: number /* 1..24 */ }
  | { kind: 'fixed_costs'; cutPct: number /* 0..50 */; startMonth: number; oneOffCost?: number /* ≥ 0, ₸ */ }
export interface WhatIfMetrics {
  annualRunRateAtDeadline: number | null   // годовой run-rate к сроку цели (в месяц срока)
  revenueFirst12m: number | null
  timeToGoalMonths: number | null          // null — цель не достигнута в горизонте
  minCash: { value: number; month: number } | null   // только уровень 2
  cashGapMonth: number | null
  fundingNeed: number | null
  ebitdaFirst12m: number | null
}
export interface WhatIfResult {
  modelVersion: string; level: DataLevel; computedAt: string
  baseline: WhatIfMetrics; changed: WhatIfMetrics
  delta: { [K in keyof WhatIfMetrics]?: number | null }        // changed − baseline там, где оба числа
  contributions: Array<{ kind: WhatIfKind; label: string; delta: WhatIfResult['delta'] }>
  interaction: WhatIfResult['delta']
  series: { months: number[]; baseline: number[]; changed: number[]; target: number | null }   // годовой run-rate по месяцам, month 0 = сейчас
  explanation: string[]; riskFlags: string[]; assumptions: string[]; warnings: string[]
  applicable: Record<WhatIfKind, { ok: boolean; reason: string | null }>
}
export function runWhatIf(inputs: ModelInputs, changes: WhatIfChange[], opts?: { profile?: ScenarioProfile; horizonMonths?: number }): WhatIfResult
export function validateWhatIf(raw: unknown): { ok: true; changes: WhatIfChange[] } | { ok: false; error: string; field: string }
export const WHATIF_LABELS: Record<WhatIfKind, string>
```

Базовый случай — «ничего не менять»: рычаги постоянны на текущих значениях (воронка, с калибровкой и сезонностью, как в Ф2) либо, для модели роста, текущий годовой run-rate с трендом из `forecast.trendMonthlyPct` (если нет — плоско). Изменения входят линейно за `profile.rampMonths` (по умолчанию 12; профиль «Умеренный»), кроме `revenue_shock`, `hire` и `fixed_costs`, у которых момент задан `startMonth`. Горизонт — `max(срок цели, rampMonths) + 12`, не больше 60.

---

### Task 1: Миграция 127 — `pb_saved_scenarios`

**Files:**
- Create: `supabase/migrations/127_point_b_saved_whatif.sql`
- Test: `tests/unit/point-b/migration-127.test.ts` (по образцу `migration-126.test.ts`)

**Interfaces:**
- Produces: `public.pb_saved_scenarios(id uuid pk default gen_random_uuid(), company_id text not null → companies(id) on delete cascade, user_id uuid not null → auth.users(id) on delete cascade, name text not null check (length(btrim(name)) between 1 and 80), note text check (note is null or length(note) <= 500), changes jsonb not null check (jsonb_typeof(changes) = 'array' and pg_column_size(changes) <= 16384), summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 16384), model_version text not null, proposed_at timestamptz, proposal_message_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`; индекс `(company_id, created_at desc)`; триггер `set_updated_at`; RLS включён, `REVOKE ALL … FROM PUBLIC, anon`, `GRANT SELECT TO authenticated` с политикой `user_id = (SELECT auth.uid())`, запись только `service_role`; `NOTIFY pgrst, 'reload schema'`; идемпотентна. Лимит 20 на компанию проверяет код, не БД.
- [ ] **Step 1: Write the failing test** (читает SQL): `'creates the table idempotently'`; `'RLS on, anon revoked, no write grants for authenticated'`; `'select policy is owner-only'`; `'name 1..80, note ≤ 500, changes is an array'`; `'index and updated_at trigger exist'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/migration-127.test.ts` → FAIL. **Step 3: Implement** (шапка-комментарий в стиле 126; **не применять**). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): migration 127 — saved what-if scenarios`.

### Task 2: Движок «что если»

**Files:**
- Create: `lib/point-b/model/whatif.ts`
- Modify: `lib/point-b/model/cash.ts` (аддитивно: необязательные `marketingPath?: number[]`, `fixedCostsPath?: number[]`, `oneOff?: number[]` в `CashInputs`; без них поведение Ф3 не меняется), при необходимости `funnel.ts`/`scenarios.ts` — только экспорт уже существующих вспомогательных функций
- Test: `tests/unit/point-b/model-whatif.test.ts`

**Interfaces:**
- Produces: контракт выше. Формулы изменений (по входам):
  - `marketing`: `leads_t = leads0 · (1 + budgetPct · efficiency · u_t)`; затраты на маркетинг `Marketing_t = Marketing_base_t · (1 + budgetPct · u_t)` (затраты растут пропорционально решению, клиенты — с эффективностью); `u_t = min(1, t / rampMonths)`; нужен CAC или расходы на рекламу, иначе деньги по этому изменению `null` с пометкой «нужен CAC / расходы на рекламу», выручка считается.
  - `hire`: к ФОТ добавляется `count · payrollPerEmployee` с месяца `startMonth` (стоимость сотрудника = `payroll_month / headcount`, нужен ФОТ и численность, иначе `applicable.ok = false`); эффект на выручку — `revenueEffectPct · (выручка на сотрудника) · count` линейно за `rampMonths` после старта (по умолчанию 0: эффект на выручку не предполагается, это сказано в `assumptions`).
  - `avg_check`: `check_t = check0 · (1 + pct · u_t)`, `conversion_t = conversion0 · (1 − demandElasticity · pct · u_t)` (не ниже 0, не выше 0.6).
  - `conversion`: `conversion_t = clamp(conversion0 + pp/100 · u_t, 0, 0.6)`.
  - `revenue_shock`: выручка месяца умножается на `(1 + pct)` в месяцах `startMonth … startMonth + durationMonths − 1` (затраты не меняются; COGS пропорционален выручке, как в базовой модели).
  - `fixed_costs`: `FixedCosts_t = fixed · (1 − cutPct)` с месяца `startMonth`, плюс разовые затраты `oneOffCost` в месяц `startMonth` (в `oneOff`).
- `runWhatIf`: базовый прогон и прогон «изменено» через `simulateFunnel`/`projectGrowth` и (уровень 2) `simulateCash`; метрики из §Контрактов; вклады — отдельный прогон на каждое изменение (`delta` относительно базы); `interaction = delta(совместно) − Σ delta(вклады)`; `explanation` — правила («Чек +10% при эластичности 0,3 даёт +6,9% к выручке…» только с числами из расчёта), `riskFlags` — кассовый разрыв, `fundingNeed > 0`, срок цели сдвигается позже, выручка падает ниже цели; `applicable` для всех 6 видов (воронка нужна для `marketing`, `avg_check`, `conversion`; `hire` — ФОТ и численность; `revenue_shock` и `fixed_costs` — база выручки на уровне ≥ 1, `fixed_costs` деньги — финмодель); уровень 0 → `applicable.ok = false` для всех с причиной.
- `validateWhatIf`: Zod-проверка диапазонов контракта; ошибка с `field` (напр. `changes[1].pp`) и русским текстом; не более 6 изменений, не более одного каждого вида; `startMonth` ≤ горизонта.
- Consumes: `ModelInputs`, `ScenarioProfile`/`defaultProfiles`, `simulateFunnel`, `calibrate`, `seasonalityIndex`, `projectGrowth`, `simulateCash`, `computeModel` (Ф2/Ф3).
- [ ] **Step 1: Write the failing tests:** `'no changes: changed equals baseline exactly'`; **золотые**: e-commerce база (leads 300, conversion 0.12, check 140 000, база 60,48 млн как в Ф2): `avg_check +10%` при эластичности 0 → run-rate на плато ×1,10; при эластичности 0,3 → ×(1,10 · (1 − 0,03)) = ×1,067 — значения считаются руками и фиксируются; `conversion +2 п.п.` → ×(0,14/0,12); `revenue_shock −20%` на 3 месяца с месяца 2 → выручка этих месяцев ×0,8, остальные не меняются; `fixed_costs −10% с месяца 1` при постоянных 1 млн → EBITDA +0,1 млн в месяц; `hire 2` без эффекта на выручку → ФОТ +2·(payroll/headcount), выручка не меняется; `'two changes together equal one full run and sum(contributions) + interaction = combined'`; `'marketing +50% with efficiency 0.7 raises leads by 35% and marketing cost by 50% (level 2)'`; `'no CAC: marketing revenue effect computed, money null with the note'`; `'growth model: marketing, avg_check and conversion are not applicable with a reason; revenue_shock and fixed_costs work'`; `'level 0: all not applicable'`; `'cash gap appears under a revenue shock at level 2 and riskFlags mention it'`; `'extreme values rejected by validateWhatIf with the field: pp 30, budgetPct −100, startMonth 99, count 0, more than 6 changes, duplicate kind'`; `'determinism and JSON-safety (no NaN)'`; `'identities of the cash model still hold in the changed run (Σ CF = Δcash)'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b` → PASS (все золотые тесты Ф2/Ф3 остаются зелёными).
- [ ] **Step 5: Commit** `feat(point-b): what-if engine — full recompute with contributions and interaction`.

### Task 3: Маршруты «что если»

**Files:**
- Create: `app/api/v1/point-b/whatif/route.ts` (POST расчёт), `app/api/v1/point-b/whatif/saved/route.ts` (GET список, POST сохранить), `app/api/v1/point-b/whatif/saved/[id]/route.ts` (DELETE), `app/api/v1/point-b/whatif/saved/[id]/propose/route.ts` (POST), `app/api/giga-admin/users/[id]/point-b/whatif/saved/route.ts` (GET только чтение), `lib/point-b/whatif-store.ts`
- Test: `tests/unit/point-b/routes-whatif.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/point-b/whatif` `{ changes: WhatIfChange[], scenario?: 'cautious' | 'moderate' | 'aggressive' }` → `{ ok, data: WhatIfResult }`. Идентичность из сессии, гейт `point_b` (402), лимит 60/10 мин (`isRateLimitedKey`, 429), валидация `validateWhatIf` (400 с `field`), входы через `loadModelForCompany`; **ничего не пишет**; в режиме «от имени» расчёт разрешён (чтение).
  - `GET …/saved` → `{ ok, data: Array<{ id, name, note, changes, summary, modelVersion, proposedAt, createdAt }> }` (до 20, новые первыми); `POST …/saved` `{ name, note?, changes }` → сохраняет вместе с `summary` (ключевые дельты и `level`), считается на сервере (клиентскому `summary` не доверяем); ошибки: 400 (имя пустое/длиннее 80, мат — `field`), 409 `limit` при 20; запрещено «от имени» (403).
  - `DELETE …/saved/:id` → удаляет только свой (404 иначе); запрещено «от имени».
  - `POST …/saved/:id/propose` `{ comment? }` → отправляет входящее сообщение клиента эксперту через `recordInbound({ userId, channel: 'app', body })` с текстом «Предлагаю учесть в плане сценарий «<имя>»: <краткое описание изменений>. <комментарий>», ставит `proposed_at` и `proposal_message_id`; повторное предложение того же сценария → 409 `already_proposed` без нового сообщения; запрещено «от имени»; мат в `comment` — 400.
  - Эксперт `GET /api/giga-admin/users/:id/point-b/whatif/saved` (`clients.review` + `guardClientAccess`) → тот же список только для чтения.
- Consumes: Task 2, `loadModelForCompany` (Ф2), `recordInbound` (`lib/comm/inbound`), `gateFeature`, `activeImpersonation`, `isRateLimitedKey`, `profanityResponse`.
- [ ] **Step 1: Write the failing tests:** `'POST whatif: 401, 402 for free tier with gates on, 400 with field for invalid changes, 429 over the limit'`; `'POST whatif returns the result for a level-1 client and never writes'`; `'POST whatif works while impersonating (read)'`; `'saved: save computes the summary on the server and ignores a client summary'`; `'name longer than 80 or profane → 400 with field'`; `'21st saved scenario → 409 limit'`; `'DELETE of another user’s or another company’s scenario → 404 and no delete'`; `'save and delete while impersonating → 403'`; `'propose sends one inbound message to the owner’s thread, sets proposed_at, and a second propose → 409 without a second message'`; `'propose without a thread creates the thread (recordInbound) and does not fail'`; `'expert GET works only for the expert’s clients; another client → 403'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/api tests/unit/comm` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): what-if routes — calculate, save, delete, propose to the expert`.

### Task 4: Клиент — вкладка «Что если»

**Files:**
- Create: `components/point-b/tabs/WhatIfTab.tsx`, `components/point-b/whatIfController.ts`, `components/point-b/useWhatIf.ts`, `components/point-b/WhatIfChart.tsx`, `components/point-b/whatIfModel.ts`
- Modify: `components/point-b/tabs/PointBTabs.tsx` и `overviewModel.ts` (вкладка «Что если» между «Сценарии» и «Финмодель»), `lib/point-b/fixtures.ts` + `app/dev/point-b-preview/page.tsx` (`?tab=whatif`, фикстура `fixtureWhatIf` без реальной модели)
- Test: `tests/unit/point-b/whatif-ui.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/point-b/whatif`, `GET/POST …/saved`, `DELETE …/saved/:id`, `POST …/saved/:id/propose` (Task 3); типы `WhatIfChange`, `WhatIfResult`, `WhatIfKind`, `WHATIF_LABELS` из `@/lib/point-b/model/whatif` (**только типы и константы**, не `runWhatIf`); состояние уровня и `missing` из `usePointBState`.
- Поведение (спека §10): слева шесть карточек калькуляторов (включение, слайдер + поле ввода со значением и единицей, сброс карточки; недоступные — серые с причиной из `applicable`); справа результат: «Сейчас → При изменении → Δ» для выручки к сроку, срока достижения цели, минимальной кассы, кассового разрыва, потребности в финансировании (деньги — только при уровне 2, иначе строка «Откроется после заполнения финмодели» со ссылкой на вкладку), график `WhatIfChart` (две линии run-rate и линия цели, подпись по касанию), вклад каждого изменения и «эффект взаимодействия», объяснение, флаги рисков, «Допущения» раскрывающимся списком; расчёт с задержкой 400 мс после изменения (debounce) и отменой устаревшего запроса; кнопки «Сбросить всё», «Сохранить сценарий» (имя ≤ 80, комментарий), список сохранённых (загрузить в калькуляторы, удалить, «Предложить эксперту» с комментарием; после предложения — «Предложено эксперту»); пометка «Расчёт на ваших данных. Это не рекомендация и не меняет план»; на уровне 0 вместо калькуляторов — честное объяснение и список недостающего (`DataGapBanner`); 402 — `PointBPaywall`; в режиме «от имени» кнопки сохранения/предложения скрыты; мобильная версия: калькуляторы и результат одним столбцом, график под результатом.
- [ ] **Step 1: Write the failing tests** (контроллер без React + `renderToStaticMarkup`, мок `fetch`, fake timers): `'six calculators render with ranges, units and the label «не рекомендация»'`; `'unavailable calculators are greyed with the reason from applicable'`; `'a change triggers one debounced request and an outdated request is ignored'`; `'result shows now → changed → Δ, contributions and interaction; money rows only at level 2, otherwise the finmodel hint'`; `'reset restores defaults and clears the result'`; `'save posts name and changes (no summary), shows the saved list; delete and propose update the list and show «Предложено эксперту»'`; `'server field errors are shown near the right calculator'`; `'level 0 shows the explanation instead of calculators'`; `'402 renders the paywall'`; `'chart has no NaN and marks the goal line'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit -p .`; eslint.
- [ ] **Step 5: Commit** `feat(point-b): what-if tab — six calculators, comparison, chart, saved scenarios`.

### Task 5: Эксперт — сохранённые «что если» клиента

**Files:**
- Create: `components/giga-panel/user360/point-b/WhatIfSavedPanel.tsx`, `whatIfSavedController.ts`
- Modify: `components/giga-panel/user360/PointBTab.tsx` (встроить панель)
- Test: `tests/unit/point-b/whatif-saved-panel.test.ts`

**Interfaces:**
- Consumes: `GET /api/giga-admin/users/:id/point-b/whatif/saved` (Task 3).
- Поведение: список сохранённых «что если» клиента (имя, дата, краткая сводка изменений, дельты ключевых метрик из `summary`, отметка «Предложено клиентом» с датой); только чтение; пустое состояние; ошибка текстом сервера.
- [ ] **Step 1: Write the failing tests:** `'lists saved what-ifs with summary and the proposed mark'`; `'empty state'`; `'server error is shown'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): expert view of the client's saved what-if scenarios`.

### Task 6: Закрытие фазы

- [ ] **Step 1:** полный `npx vitest run`, `npx tsc --noEmit -p .`, eslint по изменённым файлам; `tests/unit/metrics/*`, `survey/*`, `point-a*/*` не менялись и зелёные.
- [ ] **Step 2:** визуальная проверка `/dev/point-b-preview?variant=level2&tab=whatif` (десктоп и 375 px, без горизонтального переполнения; поля ввода ≥ 16 px), итог в `docs/superpowers/specs/2026-10-18-point-b-visual-audit.md` («После Ф4»).
- [ ] **Step 3:** применить миграцию 127 к проду при отправке (`node scripts/apply-migration.js supabase/migrations/127_point_b_saved_whatif.sql`, проверка RLS запросом на чтение), отправка в main, ожидание деплоя, `curl`: `/api/v1/point-b/whatif` (POST без сессии → 401); обновить память; написать план Ф5.

## Порядок выполнения

1 → 2 → 3; Tasks 4 и 5 строятся по контрактам (мок `fetch`) параллельно с 2–3; Task 6 — последней.

## Self-Review (выполнено)

- **Покрытие спеки Ф4 (§9.5, §10, MVP: калькуляторы 1–6):** маркетинг, найм, чек, конверсия, падение выручки (стресс), постоянные расходы (T2); слайдеры и ввод, сравнение база/изменение, график, сохранение, сброс, объяснение, допущения, «применить к плану» как предложение эксперту (T3, T4); вклад каждого изменения и взаимодействие — без двойного учёта (T2). Не входят: калькуляторы 7–12 (отложить инвестиции, срок цели, производительность, новое направление, кредит, потеря клиента), торнадо и стресс-тесты — V2.
- **Типы:** `WhatIfChange`/`WhatIfResult`/`WhatIfKind` объявлены в контрактах (T2) и используются в T3–T5; `summary` сохраняется сервером (T3) и читается в T4–T5.
- **Review Focus:** воронка/уровень 0 (T2, T4), экстремальные значения (T2), двойной учёт (T2), чужие сценарии и режим «от имени» (T3), предложение без эксперта и повторное (T3).
- **Пропорции:** задачи — сигнатуры, формулы, названия тестов; тел функций нет.
