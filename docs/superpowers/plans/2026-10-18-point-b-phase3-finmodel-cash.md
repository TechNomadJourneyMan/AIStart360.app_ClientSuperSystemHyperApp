# Точка Б — Ф3 (финмодель и денежный поток, уровень 2): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Уровень данных 2: клиент и эксперт вводят «Финмодель» (деньги на счёте, постоянные расходы, ФОТ, долги, оборотный капитал, налог, капитальные затраты) с подсветкой нехватки данных, а модель считает прибыль и **денежный поток раздельно**, потребность в финансировании, резерв ликвидности и цену достижения по каждому сценарию.

**Architecture:** Входы финмодели живут в новой таблице `pb_finmodel_inputs` (миграция 126), **а не в реестре метрик Точки А** — отклонение от §7.2 спеки по итогам разведки кода: новые метрики реестра двигали бы покрытие Точки А (`aggregator`, `buildTopGaps`, `metricsTotal`), прогресс анкеты («N из M») и упирались в инварианты `metric-invariants.test.ts` (148 метрик, обязательный реальный путь значения). Загрузчик объединяет **уже существующие** источники (метрики `opex`, `cash_flow_mes`, дебиторка, численность, CAC, маржа; ключи анкеты шага 9 `s9n_debts_amount`, `s9n_debtor_days`, `s9n_expense_*`) со значениями, которые вводят владелец и эксперт; правка финмодели **не запускает пересчёт Точки А**. Модель получает расширение `finance` (прибыль, ΔNWC, капекс, обслуживание долга, касса) и считает уровень 2.

**Tech Stack:** TypeScript, Next.js 14, Supabase (service client, RLS), Zod, Vitest, SVG без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§5 уровни, §7 финмодель и подсветка, §9.2–9.4 формулы и сценарии, §15). Предыдущие планы Ф0–Ф2 должны быть в main. После этого плана в спеку §7.2 вносится примечание об отклонении (Task 9).

## Global Constraints

- Те же ограничения, что в планах Ф1/Ф2: не трогать «Гри» (`lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`); не удалять отклонённые PO компоненты и старый движок; локальный `.env` = **продовая БД**: без dev-сервера, без записывающих скриптов, **миграцию 126 применяет ведущий при отправке в main после зелёных тестов** (слово PO получено); тесты без сети и БД; UI на русском на токенах проекта (без зашитых цветов, PO заменит дизайн); фильтр мата на `note`; `tsc`, `eslint`, тесты зелёные; отдельный коммит на задачу с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; перед отправкой полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), редкий таймаут интеграционных `point-a-aggregate` / `metrics-resolver`).
- **Не трогать реестр метрик, ключи анкеты (`SURVEY_KEY_STEP`), `BLOCK_LIBRARY`, `pointAChecks`, `RESOLVED_INPUT_METRICS`, шаг 9 анкеты и `lib/point-a/**`** — баллы, покрытие и прогресс Точки А не должны измениться; тест `tests/unit/metrics/metric-invariants.test.ts` и `tests/unit/survey/*` остаются без правок и зелёными.
- Прибыль и денежный поток считаются **раздельно**; тождество `Σ CF = Cash_конец − Cash_начало` и `Σ CF = Σ чистой прибыли − Σ ΔNWC − Σ капекса − Σ погашения основного долга` проверяется тестом.
- Нет входа → `null` и пометка «данных не хватает»; безопасные значения по умолчанию **только** для налога и оборотного капитала (DSO/DIO/DPO) из отраслевого шаблона, всегда с `origin: 'default'`, пометкой в `assumptions` и расширенной полосой неопределённости (±25% вместо ±20%); для денег на счёте, ФОТ, постоянных расходов и долга значений по умолчанию **нет** (уровень 2 недоступен без них). `0` — допустимый ответ для долга, капекса и обслуживания долга.
- Вводимые значения: неотрицательные, в диапазонах из `FINMODEL_KEYS` (ошибка валидации с понятным текстом, а не усечение); ввод владельца помечается `entered`, проверка эксперта — `verified` (с именем и датой); значение, изменённое после проверки, снова `entered`.
- Права и видимость как в Ф1/Ф2: клиентские маршруты — сессия, гейт `point_b` (402), запись запрещена в режиме «от имени»; экспертные — `clients.review` + `guardClientAccess`/`forbidTarget`, аудит `recordAdminAction`. Расчёт с деньгами показывается клиенту: в «Обзоре» — предварительный (метка «автоматический»), в «Сценариях» — только из одобренной версии (как в Ф2).
- Версия модели повышается: `MODEL_VERSION = 'pb-model-2'` (результаты `pb-model-1` читаются, но помечаются «пересчитайте»).

## Review Focus

- Клиент ввёл только часть полей (есть деньги, нет ФОТ) → уровень 1 с подсветкой оставшегося, **не** частичный уровень 2 и не нули вместо отсутствующих значений.
- Кассовый разрыв в агрессивном сценарии при положительной прибыли (оборотный капитал и капекс «съедают» деньги) → разрыв показан, прибыль и касса различимы; отрицательная начальная касса и нулевой остаток не ломают расчёт.
- Долг с нулевым или отсутствующим платежом, ставка 0%, долг, который гасится раньше горизонта → корректные проценты и погашение, без отрицательного долга.
- Правка значения после проверки экспертом → статус возвращается в `entered`; чужой клиент / чужая компания → 403/404 без записи; запись в режиме «от имени» и без PRO → отказ.
- Расходы по модели расходятся с фактом (`opex`) больше чем на 25% → предупреждение в `warnings`, расчёт не скрывается.

---

## Контракты

```ts
// lib/point-b/finmodel/keys.ts
export const FINMODEL_KEYS = ['cash_balance','fixed_costs_month','payroll_month','debt_total','debt_service_month','interest_rate_annual','dso_days','dio_days','dpo_days','tax_rate','capex_year'] as const
export type FinmodelKey = typeof FINMODEL_KEYS[number]
export interface FinmodelKeyDef {
  key: FinmodelKey; label: string; unit: '₸' | '%' | 'days'; /* % хранится долей 0..1 */
  min: number; max: number; hint: string                      // где взять число
  required: boolean                                           // жёсткий вход уровня 2 (без значения по умолчанию)
  requiredIf?: (v: Partial<Record<FinmodelKey, number | null>>) => boolean   // debt_service/interest нужны при debt_total > 0
  surveyKey?: string; metricId?: string                       // откуда подставляется из существующих данных
  unlocks: string                                             // что откроется («касса и кассовый разрыв»…)
}
export const FINMODEL_DEFS: Record<FinmodelKey, FinmodelKeyDef>
export function templateDefaults(template: TemplateKey): Pick<Record<FinmodelKey, number>, 'tax_rate' | 'dso_days' | 'dio_days' | 'dpo_days'>
// lib/point-b/finmodel/store.ts
export type FinmodelOrigin = 'owner' | 'expert' | 'survey' | 'metric' | 'default'
export interface FinmodelValue { key: FinmodelKey; value: number; origin: FinmodelOrigin; status: 'entered' | 'verified' | 'auto'; period: string | null; asOf: string | null; note: string | null; verifiedByName: string | null; verifiedAt: string | null; updatedAt: string | null }
export interface FinmodelState { values: Partial<Record<FinmodelKey, FinmodelValue>>; missing: FinmodelKey[]; complete: boolean; defaulted: FinmodelKey[] }
// lib/point-b/model/types.ts (аддитивно)
export interface ScenarioFinance {
  ebitda: number[]; netProfit: number[]; cash: number[]; nwc: number[]        // по месяцам 1..H (Task 3 фиксирует H = max(срок цели, срок выхода) + 12, не больше 60)
  minCash: { value: number; month: number }
  cashGapMonth: number | null                     // первый месяц с кассой < 0
  fundingNeed: number                             // max(0, MinReserve − min Cash)
  reserveRequired: number                         // reserveMonths × месячные обязательные расходы
  totals: { revenue: number; ebitda: number; netProfit: number; operatingCashFlow: number; capex: number; debtService: number }
  assumptions: string[]
}
// ScenarioResult.finance?: ScenarioFinance  (опционально; level 2); ModelResult.level может быть 2;
// ModelInputs.finmodel: FinmodelState | null
```

---

### Task 1: Миграция 126 — `pb_finmodel_inputs`

**Files:**
- Create: `supabase/migrations/126_point_b_finmodel.sql`
- Test: `tests/unit/point-b/migration-126.test.ts` (по образцу `migration-125.test.ts`)

**Interfaces:**
- Produces: таблица `public.pb_finmodel_inputs(id uuid pk default gen_random_uuid(), company_id text not null → companies(id) on delete cascade, key text not null check in (11 ключей из FINMODEL_KEYS), value numeric(20,6) not null check (value >= 0), period_key text not null default '' (период факта: `YYYY-MM`, `YYYY` или пусто для «на дату»), as_of date null, origin text not null check in ('owner','expert'), status text not null default 'entered' check in ('entered','verified'), note text null check (length <= 500), verified_by uuid null, verified_by_name text null, verified_at timestamptz null, updated_by uuid null, created_at, updated_at)`; уникальный индекс `(company_id, key, period_key)`; триггер `set_updated_at`; RLS включён, `REVOKE ALL … FROM PUBLIC, anon`, `GRANT SELECT TO authenticated` с политикой `public.can_read_company(company_id)`, запись только `service_role`; `NOTIFY pgrst, 'reload schema'`; идемпотентна.
- [ ] **Step 1: Write the failing test** (читает SQL): `'creates the table idempotently'`; `'RLS on, anon revoked, authenticated has no write grants'`; `'unique per company, key and period'`; `'value must be non-negative; origin limited to owner and expert; status to entered and verified'`; `'select policy uses can_read_company'`; `'the key CHECK lists exactly the 11 FINMODEL_KEYS'` (сверка со списком из `lib/point-b/finmodel/keys.ts` — файл создаётся в Task 2; в этой задаче тест сравнивает со списком литералом, а в Task 2 добавляется перекрёстная проверка).
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/migration-126.test.ts` → FAIL.
- [ ] **Step 3: Implement** миграцию (шапка-комментарий в стиле 125). **Не применять.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): migration 126 — finmodel inputs`.

### Task 2: Определения ключей и хранилище финмодели

**Files:**
- Create: `lib/point-b/finmodel/keys.ts`, `lib/point-b/finmodel/store.ts`, `lib/point-b/finmodel/sources.ts`
- Test: `tests/unit/point-b/finmodel-store.test.ts`, `tests/unit/point-b/finmodel-keys.test.ts`

**Interfaces:**
- Produces: контракты выше (`FINMODEL_KEYS`, `FINMODEL_DEFS`, `templateDefaults`, `FinmodelState`) и
  ```ts
  loadFinmodel(sb: SupabaseClient, input: { companyId: string; template: TemplateKey; pb: PointBInputs }): Promise<FinmodelState>
  saveFinmodelValues(sb: SupabaseClient, input: { companyId: string; actor: { id: string; role: 'owner' | 'expert'; name: string | null }; values: Array<{ key: FinmodelKey; value: number; asOf?: string | null; period?: string | null; note?: string | null }> }): Promise<FinmodelState['values']>   // валидация диапазонов, мат в note → ProfanityError, повторный ввод → status 'entered', actor.role → origin
  verifyFinmodelValues(sb: SupabaseClient, input: { companyId: string; keys: FinmodelKey[]; reviewer: { id: string; name: string } }): Promise<void>   // только строки в БД (введённые людьми); 'auto' из метрик не «проверяются»
  export class FinmodelError extends Error { code: 'invalid_value' | 'unknown_key' | 'not_found'; field?: string }
  ```
- Правила слияния (приоритет по убыванию): значение эксперта (`verified` > `entered`) → значение владельца → ключ анкеты (`surveyKey`, origin `survey`: `s9n_debts_amount` → `debt_total`, `s9n_debtor_days` → `dso_days`; `s9n_expense_rent` + `s9n_expense_other` (текстовые ₸/год) → `fixed_costs_month` = (аренда + прочие) / 12, только если оба числа читаются) → существующая метрика (`metricId`, origin `metric`: `biz.finansy.cash_flow_mes` **не** подставляется как деньги на счёте; `biz.finansy.debitorskaya_zadolzhennost` → контроль для DSO; `biz.finansy.operatsionnye_raskhody` / `goal.01.raskhody_na_reklamu` / `biz.hr.kol_vo_sotrudnikov` читаются моделью напрямую, не через `FinmodelState`) → значение по умолчанию (**только** `tax_rate`, `dso_days`, `dio_days`, `dpo_days`, из `templateDefaults`, origin `default`, ключ попадает в `defaulted`). `missing` — жёсткие входы без значения плюс условные (`debt_service_month` и `interest_rate_annual` при `debt_total > 0`); `complete` = `missing` пуст.
- `templateDefaults`: tax_rate 0.10 для всех; DSO: ecommerce 3, services 21, production 30, default 14; DIO: ecommerce 45, services 0, production 60, default 20; DPO: ecommerce 20, services 0, production 30, default 15 (дни).

- [ ] **Step 1: Write the failing tests:** `'each of the 11 keys has a definition with label, unit, range, hint, unlocks'`; `'FINMODEL_KEYS equals the key list in migration 126'`; `'a value outside the range or negative is rejected with invalid_value and the field name'`; `'0 is valid for debt_total, capex_year and debt_service_month'`; `'owner entry is origin owner status entered; expert entry origin expert'`; `'verifying sets verified_by, name and date; re-entering a verified value returns it to entered'`; `'merge priority: expert verified beats owner beats survey beats metric beats default'`; `'fixed_costs_month comes from survey rent and other costs divided by 12 only when both are numbers'`; `'defaults are applied only to tax and NWC days and listed in defaulted'`; `'cash_balance, payroll_month, fixed_costs_month and debt_total have no defaults and stay in missing'`; `'debt_service and interest become required when debt_total > 0'`; `'profanity in note throws with the field'`; `'complete is true only when missing is empty'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): finmodel keys, merge of existing sources with owner/expert input, store`.

### Task 3: Модель уровня 2 — прибыль, денежный поток, нехватка денег

**Files:**
- Create: `lib/point-b/model/cash.ts`
- Modify: `lib/point-b/model/types.ts` (аддитивно: `ScenarioFinance`, `ScenarioResult.finance?`, `ModelInputs.finmodel`, `MODEL_VERSION = 'pb-model-2'`), `lib/point-b/model/inputs.ts` (`buildModelInputs` принимает `finmodel`), `lib/point-b/model/levels.ts` (`determineLevel` → 2), `lib/point-b/model/scenarios.ts` (после решения сценария добавить `finance` для уровня 2), `lib/point-b/model/compute.ts` (предупреждения), `lib/point-b/model/load.ts` (загрузка финмодели в `loadModelForCompany`)
- Test: `tests/unit/point-b/model-cash.test.ts`, дополнить `model-compute.test.ts`, `model-scenarios.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CashInputs {
    revenue: number[]; newCustomers: number[]                     // по месяцам 1..H из траектории сценария (funnel) или revenue (growth; newCustomers = null → маркетинг по доле выручки базового периода)
    margin: number                                                // валовая маржа, доля
    cac: number | null; marketingMonthlyBase: number | null
    headcount0: number | null; payrollMonthly: number; payrollGrowth: number[]   // рост ФОТ от найма (Task 3: staffNeed линейно за rampMonths)
    fixedCostsMonthly: number
    cash0: number; debt0: number; debtServiceMonthly: number; interestRateAnnual: number
    dso: number; dio: number; dpo: number; taxRate: number; capexYear: number
    reserveMonths: number
  }
  export function simulateCash(c: CashInputs): ScenarioFinance
  ```
  Формулы (спека §9.2–9.3): `Marketing_t = newCustomers_t · CAC` (CAC постоянен, допущение), `Payroll_t = payrollMonthly · (1 + payrollGrowth_t)`, `COGS_t = Revenue_t · (1 − margin)`, `EBITDA_t = Revenue − COGS − Marketing − Payroll − FixedCosts`; `Interest_t = Debt_{t−1} · rate / 12`, `Principal_t = min(Debt_{t−1}, max(0, debtService − Interest_t))`, `Debt_t = Debt_{t−1} − Principal_t`; `Tax_t = max(0, taxRate · (EBITDA_t − Interest_t))`; `NetProfit_t = EBITDA − Interest − Tax`; `NWC_t = Revenue_t·dso/30 + COGS_t·dio/30 − COGS_t·dpo/30`, `ΔNWC_t = NWC_t − NWC_{t−1}` (NWC_0 по базовой выручке без роста); `CFO = EBITDA − Tax − ΔNWC`, `CF_t = CFO − Interest − Principal − Capex_t` (`Capex_t = capexYear / 12`); `Cash_t = Cash_{t−1} + CF_t`; `reserveRequired = reserveMonths · (Payroll + FixedCosts + Marketing)` базового месяца; `fundingNeed = max(0, reserveRequired − min Cash)`; `cashGapMonth` — первый месяц с `Cash < 0`.
- Поведение в сценариях: `finance` считается для каждого сценария по его траектории выручки; `investments.marketingMonthlyIncrease` и `staffNeed` (Ф2) используются; `investments.totalOverRamp` для уровня 2 = накопленный прирост маркетинга + оценка стоимости найма (`staffNeed × payroll на сотрудника × rampMonths / 2`), без выдуманных значений при отсутствии CAC/численности (`null` + пометка). Риски сценария дополняются правилами: `cashGapMonth !== null` → «Кассовый разрыв в месяце N»; `fundingNeed > 0` → «Нужно финансирование около X»; прибыль > 0 при `cash` ниже резерва → «Оборотный капитал и платежи съедают деньги». Предупреждения `computeModel`: `opex` фактический против модельного базового месяца расходятся > 25% → «Расходы по модели расходятся с фактом на N%»; значения по умолчанию использованы → «Оборотный капитал и налог — допущения по отрасли».
- Уровень 2 выдаётся, только если `finmodel.complete` и уровень 1 достижим (`funnel` или `growth`); иначе остаётся уровень 1 и `missing` содержит недостающие ключи финмодели (с `level: 2`, подписью, `unlocks` и действиями `survey | documents | expert`).
- Consumes: `FinmodelState` (Task 2), `ScenarioResult`/`simulateFunnel` (Ф2).

- [ ] **Step 1: Write the failing tests:** **золотой пример на 3 месяца**: revenue [10, 10, 10] млн, margin 0.4, newCustomers = 0 (маркетинг 0), payroll 2 млн, fixed 1 млн, tax 0, dso/dio/dpo 0, capex 0, debt 0, cash0 5 млн → EBITDA = 4 − 3 = 1 млн в месяц, `cash = [6, 7, 8]` млн; тот же пример с DSO 30 (дебиторка = выручка) → ΔNWC первого месяца 0 при выручке = базе, а при росте выручки до 12 млн ΔNWC = 2 млн и касса отстаёт от прибыли на 2 млн; `'profit positive but cash gap: revenue growing fast with dso 60 gives cashGapMonth'`; `'debt: interest = debt·rate/12, principal = service − interest, debt never negative, repaid early stops the payments'`; `'tax is zero when EBITDA − interest ≤ 0'`; `'identity: Σ CF = cash_end − cash_start'`; `'identity: Σ CF = Σ netProfit − Σ ΔNWC − Σ capex − Σ principal'`; `'fundingNeed = max(0, reserve − minCash) and is 0 when cash stays above the reserve'`; `'negative or zero starting cash does not throw'`; `'no NaN or Infinity anywhere (JSON round-trip)'`; `'level 2 only with a complete finmodel; partial input stays level 1 and lists the missing keys with unlocks'`; `'defaults for tax and NWC are listed in assumptions and widen the band'`; `'opex mismatch over 25% adds the warning and keeps the numbers'`; `'a scenario that grows faster needs more cash: fundingNeed(aggressive) ≥ fundingNeed(moderate) ≥ fundingNeed(cautious) in the e-commerce golden'`; `'model version is pb-model-2'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b` → новые FAIL.
- [ ] **Step 3: Implement** чистые функции без IO и без `Date.now()`; `load.ts` читает финмодель через `loadFinmodel`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/point-b` → PASS (все прежние золотые тесты Ф2 остаются зелёными: поля `finance` добавляются только на уровне 2).
- [ ] **Step 5: Commit** `feat(point-b): level 2 — profit and cash flow separately, funding need, reserve, cash gap`.

### Task 4: Маршруты финмодели

**Files:**
- Create: `app/api/v1/point-b/finmodel/route.ts` (GET, PUT), `app/api/giga-admin/users/[id]/point-b/finmodel/route.ts` (GET, PUT), `…/finmodel/verify/route.ts` (POST)
- Modify: `lib/point-b/model/load.ts` (`PointBState.finmodel`), `app/api/v1/point-b/state/route.ts` не меняется (ответ получает поле через `loadPointBState`)
- Test: `tests/unit/point-b/routes-finmodel.test.ts`

**Interfaces:**
- Produces:
  - Клиент `GET /api/v1/point-b/finmodel` → `{ ok, data: { defs: Array<{ key, label, unit, hint, unlocks, required, min, max }>, state: FinmodelState } }`; `PUT` `{ values: Array<{ key, value, asOf?, period?, note? }> }` → `{ ok, data: { state } }` (до 20 значений; `value` — число, проценты долей 0..1; 400 `invalid_value` с `field`; 400 с `field` для мата). Идентичность из сессии, гейт `point_b` (402), запись запрещена в режиме «от имени» (403), лимит частоты (не более 30 запросов за 10 минут на пользователя через `isRateLimitedKey`). **Не запускает** пересчёт Точки А.
  - Эксперт `GET/PUT /api/giga-admin/users/:id/point-b/finmodel` (то же тело, `actor.role = 'expert'`, `clients.review` + `guardClientAccess`, аудит `point_b.finmodel.updated`), `POST …/finmodel/verify` `{ keys: FinmodelKey[] }` (аудит `point_b.finmodel.verified`; ключи без записи в БД → 400 `not_found`).
  - `PointBState` (из Ф2) получает поле `finmodel: { complete: boolean; missing: FinmodelKey[]; defaulted: FinmodelKey[] }` (без самих значений — значения отдаёт только GET `finmodel`).
- Consumes: Task 2, `gateFeature`, `activeImpersonation`, `isRateLimitedKey` (`lib/rate-limit`), `recordAdminAction`, `guardClientAccess`.
- [ ] **Step 1: Write the failing tests:** `'client GET returns defs and the merged state; 401 without session; 402 for free tier with gates on'`; `'PUT saves owner values and returns the merged state; a value out of range → 400 with the field'`; `'PUT while impersonating → 403 and no write'`; `'PUT does not enqueue a Point A recalculation'` (нет вызова `requestPointARecalc`/`emitPlatformEvent`); `'rate limit → 429'`; `'profanity in note → 400 with field note'`; `'expert PUT works only for the expert’s clients; another client → 403'`; `'expert verify marks entered values verified and refuses auto/default keys with 400'`; `'owner re-entering a verified value returns it to entered'`; `'state exposes finmodel completeness without values'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/api` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): finmodel routes for the owner and the expert`.

### Task 5: Клиент — вкладка «Финмодель», «Цена достижения», деньги в «Сценариях»

**Files:**
- Create: `components/point-b/tabs/FinmodelTab.tsx`, `components/point-b/finmodelController.ts`, `components/point-b/useFinmodel.ts`, `components/point-b/CostOfGoalCard.tsx`
- Modify: `components/point-b/tabs/PointBTabs.tsx` (вкладка «Финмодель» между «Сценарии» и «Подробности»), `components/point-b/tabs/OverviewTab.tsx` (карточка «Цена достижения» + обновлённый `DataGapBanner`), `components/point-b/tabs/ScenariosTab.tsx` (строки денег в таблице сравнения и в карточках), `components/point-b/overviewModel.ts` (чистая логика), `lib/point-b/fixtures.ts` + `app/dev/point-b-preview/page.tsx` (вариант `fixtureModelResult('level2')` и `?tab=finmodel`)
- Test: `tests/unit/point-b/finmodel-ui.test.ts`

**Interfaces:**
- Consumes: `GET/PUT /api/v1/point-b/finmodel` и `PointBState` (Task 4), `ScenarioResult.finance` (Task 3). Типы импортируются из `@/lib/point-b/model/types` и `@/lib/point-b/finmodel/keys`; в UI не импортируется ни модель, ни хранилище (только типы и `FINMODEL_DEFS`).
- Поведение: **«Финмодель»** — форма из 11 полей по группам («Деньги», «Расходы и люди», «Долги», «Оборотный капитал и налог»): подпись, единица, подсказка «где взять число», бейдж происхождения (`из анкеты`, `введено вами`, `проверено экспертом · имя · дата`, `допущение по отрасли`, `из данных платформы`), поле ввода (проценты вводятся как %, хранятся долей), ошибка валидации под полем, кнопка «Сохранить» (PUT только изменённых полей, `note` по желанию), для недостающих — рамка «Нужно для расчёта денег» и кнопки «Загрузить файл» (`/client/onboarding/documents`) и «Попросить эксперта» (`/client/messages`), строка «После заполнения откроется: …» из `unlocks`; после сохранения форма обновляется из ответа; **«Цена достижения»** в «Обзоре» (из `overview.result` уровня 2; на уровне 1 — серая карточка «Откроется после заполнения финмодели» с прогрессом «заполнено N из M»): инвестиции, срок, минимальная касса и месяц, нехватка денег, резерв — значения выбранного темпа (или «Умеренный»), с диапазоном там, где он есть; **«Сценарии»** — добавить строки: «Чистая прибыль за период», «Операционный денежный поток», «Минимальная касса (месяц)», «Кассовый разрыв» (плашка с месяцем), «Нужно финансирование», «Резерв ликвидности»; **график кассы** — компонент `CashChart` (SVG: линия кассы по месяцам, отметка нуля и резерва, подпись по касанию) в карточке сценария; клиент без PRO — `PointBPaywall` как в Ф1; ошибка секции локальна.
- [ ] **Step 1: Write the failing tests** (стиль Ф1б/Ф2: контроллер без React + `renderToStaticMarkup`, мок `fetch`): `'form shows 11 fields grouped with hints and origin badges'`; `'percent fields are entered as % and sent as fractions'`; `'only changed fields are sent'`; `'server field errors are shown under the field'`; `'missing keys get the frame, unlocks text and the two actions'`; `'cost-of-goal card shows the level-2 numbers, and the grey placeholder with N of M at level 1'`; `'scenarios table has the money rows and flags the cash gap month'`; `'cash chart has no NaN and marks zero and reserve'`; `'verified badge shows the expert name and date'`; `'402 renders the paywall'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit -p .`; eslint.
- [ ] **Step 5: Commit** `feat(point-b): finmodel tab, cost of the goal, money rows and cash chart`.

### Task 6: Эксперт — финмодель клиента в User 360

**Files:**
- Create: `components/giga-panel/user360/point-b/FinmodelPanel.tsx`, `finmodelPanelController.ts`
- Modify: `components/giga-panel/user360/PointBTab.tsx` (встроить панель), `components/giga-panel/user360/point-b/ScenariosPanel.tsx` (показ финансовых итогов сценариев и предупреждений уровня 2)
- Test: `tests/unit/point-b/finmodel-panel.test.ts`

**Interfaces:**
- Consumes: `GET/PUT /api/giga-admin/users/:id/point-b/finmodel`, `POST …/finmodel/verify` (Task 4).
- Поведение: таблица ключей с текущим значением, происхождением и статусом; правка значения экспертом (PUT, `origin: expert`); чекбоксы и кнопка «Подтвердить выбранные» (verify; недоступно для `auto`/`default`); подсветка расхождения с фактом (`warnings` из расчёта), отметка «допущение по умолчанию»; ошибки 400/403/409 текстом сервера; в `ScenariosPanel` — строка «Уровень данных: 2 / 1» и итоги денег по сценариям.
- [ ] **Step 1: Write the failing tests:** `'lists keys with origin and status and the expert can edit and save'`; `'verify is offered only for values stored from people, not auto or default'`; `'server errors are shown'`; `'defaults are labelled as assumptions'`; `'scenarios panel shows level and money totals'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): expert finmodel panel with verification`.

### Task 7: Подсказки сбора данных (анкета и файлы)

**Files:**
- Modify: `lib/point-b/model/levels.ts` (тексты `missing` для уровня 2), `components/point-b/DataGapBanner.tsx`
- Test: `tests/unit/point-b/model-inputs.test.ts` (дополнить), `tests/unit/point-b/finmodel-ui.test.ts` (дополнить)

**Interfaces:**
- `MissingInput` для ключей финмодели: `{ key: 'finmodel:<key>', label, unlocks, level: 2, actions }`, где `actions` — `['expert']` для всех плюс `['survey']` только если у ключа есть `surveyKey` (долг, DSO, расходы) и `['documents']` только для ключей, которые может извлечь парсер из баланса/P&L (дебиторка, расходы, долг); остальные (деньги на счёте, ФОТ) — только форма и эксперт. `DataGapBanner` ведёт действие `survey` на шаг 9 анкеты (`/client/onboarding?step=9`), а действие «Заполнить финмодель» — на вкладку «Финмодель».
- [ ] **Step 1: Write the failing tests:** `'level 2 missing items carry the right actions per key'`; `'banner links survey to step 9 and the finmodel action to the Финмодель tab'`; `'a complete finmodel leaves no level-2 missing items'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): data-gap hints for the finmodel (survey step 9, documents, expert)`.

### Task 8: Закрытие фазы

- [ ] **Step 1:** полный `npx vitest run`, `npx tsc --noEmit -p .`, eslint по изменённым файлам; убедиться, что `tests/unit/metrics/*`, `tests/unit/survey/*`, `tests/unit/point-a*/*` не менялись и зелёные.
- [ ] **Step 2:** визуальная проверка на фикстуре `/dev/point-b-preview?variant=level2&tab=overview|scenarios|finmodel` (десктоп и 375 px, без горизонтального переполнения), итог — в `docs/superpowers/specs/2026-10-18-point-b-visual-audit.md` («После Ф3»).
- [ ] **Step 3:** применить миграцию 126 к проду при отправке (`node scripts/apply-migration.js supabase/migrations/126_point_b_finmodel.sql`, проверка RLS запросом на чтение), отправка в main, ожидание деплоя, `curl` `/api/v1/point-b/finmodel` → 401; обновить память; написать план Ф4.

## Порядок выполнения

1 → 2 → 3 → 4 → 7; Tasks 5 и 6 строятся по контрактам и могут идти параллельно с Tasks 3–4 (мок `fetch`); Task 8 — последней.

## Self-Review (выполнено)

- **Покрытие спеки Ф3:** новые входы и форма «Финмодель» (T1, T2, T4, T5, T6); подсветка нехватки и действия анкета/файлы/эксперт (T5, T7); прибыль и денежный поток раздельно, нехватка денег, резерв, кассовый разрыв (T3); цена достижения и деньги в сценариях (T3, T5); безопасные значения только для налога и NWC (T2). Отклонение от §7.2 (таблица вместо реестра метрик, шаг анкеты не добавляется) обосновано разведкой и фиксируется в спеке. Новый шаг анкеты и приём значений из документов (баланс, ДДС) — V2 (помесячные ДДС сейчас не разбираются парсером).
- **Типы:** `FinmodelKey`/`FinmodelState` (T2) используются в T3–T7; `ScenarioFinance` (T3) — в T5, T6; `PointBState.finmodel` (T4) — в T5.
- **Review Focus:** частичный ввод → уровень 1 (T3, T7), разрыв при положительной прибыли (T3), долг и ставки (T3), статусы и права (T2, T4), расхождение с фактом (T3).
- **Пропорции:** задачи — сигнатуры, формулы спеки, названия тестов; тел функций нет.
