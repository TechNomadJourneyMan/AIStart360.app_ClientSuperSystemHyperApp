# Точка Б — Ф2 (модель уровней 0–1, сценарии, «Обзор» и «Сценарии»): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Честная расчётная модель Точки Б на данных уровней 0–1 (цели и рычаги воронки) с тремя сценариями темпа, прогнозом «при текущем ходе», вердиктом и подсветкой нехватки данных, плюс клиентские вкладки «Обзор» и «Сценарии» и экспертный расчёт сценариев в версии плана.

**Architecture:** Чистые модули `lib/point-b/model/*` (без IO): вход `ModelInputs` собирается из `PointBInputs` (Ф0) и истории выручки; модель выбирается по шаблону отрасли — **воронка** (лиды × конверсия × чек × повторы) или **упрощённая модель роста**; сценарии — векторы параметров темпа (`ScenarioProfile`), для каждого решается обратная задача (прирост рычагов под цель, срок выхода, инвестиции, диапазоны). Эксперт запускает расчёт в черновике версии (результат сохраняется в `pb_plan_versions.scenarios`), клиент видит сценарии **только одобренной** версии, а «Обзор» с предварительным расчётом — всегда. Миграций нет (используются существующие jsonb-колонки миграции 125).

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase (service client), Vitest, SVG-графики без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-18-point-b-design.md` (§5 слои и уровни данных, §7 финмодель и подсветка, §9 модель и сценарии, §15 интерфейс, §21 Ф2). Аудит страницы: `…/2026-10-18-point-b-visual-audit.md`. Предыдущие планы: Ф0/Ф1б, Ф1 (должны быть закоммичены).

## Global Constraints

- Те же ограничения, что в планах Ф0/Ф1б и Ф1: не трогать «Гри» (`lib/assistant/mascot/**`, `components/assistant/mascot/**`, `lib/assistant/context.ts`); не удалять отклонённые PO компоненты и старый движок; локальный `.env` = **продовая БД**: не запускать скрипты с записью, миграций в Ф2 нет; тесты без сети и БД; UI на русском на токенах проекта (без зашитых цветов, PO заменит дизайн); фильтр мата на вводимые тексты; `tsc`, `eslint`, тесты зелёные, отдельный коммит на задачу с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; перед отправкой — полный `npx vitest run` (известные падения окружения: `tests/integration/middleware.test.ts`, `tests/unit/agents/runtime-units.test.ts` (2), редкий таймаут интеграционных `point-a-aggregate`/`metrics-resolver`).
- **Никаких выдуманных чисел:** нет входа → `null` + пометка «данных не хватает» в `missing`; безопасные значения по умолчанию — только сезонность 1.0 при истории < 24 мес (с пометкой) и параметры профилей темпа; вероятность достижения цели **не вычисляется**; диапазоны — детерминированные полосы, помеченные источником (волатильность или «по умолчанию ±20%, мало данных»).
- Модель — чистые функции, версия `MODEL_VERSION = 'pb-model-1'` пишется в каждый результат; результат детерминирован (одинаковый вход → одинаковый выход, без `Date.now()` внутри, время передаётся параметром).
- Цель задаёт **годовую выручку (run-rate) к сроку** (как в движке v2: `target_revenue_12m_kzt` — годовая сумма к концу срока); достижение цели = **первый месяц, где месячный run-rate (выручка месяца без сезонности) × 12 ≥ цель**.
- Видимость (спека §6): предварительный расчёт («Обзор») — клиенту PRO всегда, с пометкой «автоматический расчёт, не проверен экспертом»; **сценарии — только из одобренной версии плана**; пока одобренной нет — «эксперт готовит сценарии».
- Гейт PRO (`point_b`) и режим «от имени» действуют на всех новых клиентских маршрутах, как в Ф1.

## Review Focus

- Клиент без воронки (нет лидов/конверсии) или с расчётом, не сходящимся с фактом больше чем на 15%, → упрощённая модель или уровень 0 с понятной причиной, а не NaN и не тихий ноль.
- Цель ниже текущей выручки, цель в прошлом, срок < 1 месяца, срок > 60 месяцев, нулевой/отрицательный чек и конверсия > 100% → явные ошибки/предупреждения (`warnings`), модель не падает.
- История выручки короче 6 месяцев или с пропусками → прогноз `insufficient`, вердикт `no_data` (не «отстаём» и не «на курсе»); устаревшая база (спека §7) → предупреждение в `warnings` и баннер вверху «Обзора».
- Сценарий, требующий прироста рычага выше потолка реализуемости → `feasible: false` с причиной, а не «достижим».
- Клиент видит сценарии черновика или версии `in_review` → нельзя (только `approved`); эксперт не назначенного клиента не может запускать расчёт.

---

## Контракты (используются сразу несколькими задачами)

```ts
// lib/point-b/model/types.ts
export const MODEL_VERSION = 'pb-model-1'
export type DataLevel = 0 | 1 | 2
export type ModelKind = 'funnel' | 'growth' | 'none'
export type TemplateKey = 'default' | 'ecommerce' | 'services' | 'production'
export type Origin = 'fact' | 'user' | 'expert' | 'derived' | 'default'
export interface Sourced<T> { value: T | null; origin: Origin | null; period: string | null }
export interface ModelGoal { metricKey: 'biz.finansy.vyruchka_god'; targetAnnual: number; deadline: string /* YYYY-MM-DD */; months: number; reviewStatus: GoalReviewStatus }
export interface MissingInput { key: string; label: string; unlocks: string; level: 1 | 2; actions: Array<'survey' | 'documents' | 'expert'> }
export interface ModelInputs {
  template: TemplateKey
  base: { revenueYear: Sourced<number>; ageMonths: number | null; stale: boolean }
  levers: { leads: Sourced<number>; conversion: Sourced<number> /* доля 0..1 */; avgCheck: Sourced<number>; repeat: Sourced<number> /* доля 0..1 за 12 мес */; activeBase: Sourced<number>; cac: Sourced<number>; headcount: Sourced<number> }
  history: Array<{ period: string /* YYYY-MM */; revenue: number }>
  goal: ModelGoal | null
  now: string /* ISO, передаётся снаружи */
}
export interface Range { low: number | null; base: number | null; high: number | null }
export interface ScenarioProfile {
  key: 'cautious' | 'moderate' | 'aggressive'; label: string
  rampMonths: number            // за сколько месяцев рычаги выходят на целевой уровень
  reserveMonths: number         // политика резерва (используется в Ф3)
  productivityGain: number      // прирост выручки на сотрудника, доля
  growthCapAnnual: number       // потолок годового роста для упрощённой модели
  leverMix: { leads: number; conversion: number; avgCheck: number; repeat: number } // доли вклада, сумма 1
}
export interface ScenarioResult {
  key: ScenarioProfile['key']; label: string
  feasible: boolean; infeasibleReason: string | null
  timeToGoalMonths: Range; revenueAtDeadline: Range           // годовой run-rate к сроку цели
  requiredUplift: Array<{ lever: 'leads' | 'conversion' | 'avgCheck' | 'repeat' | 'growth'; label: string; current: number | null; target: number | null; upliftPct: number | null }>
  investments: { marketingMonthlyIncrease: number | null; totalOverRamp: number | null; staffNeed: number | null; note: string }
  constraints: string[]; risks: string[]; conditions: string[]; downside: string; reviewPoints: string[]; signsToChangePace: string[]; assumptions: string[]
  trajectory: Array<{ month: number; low: number; base: number; high: number }>   // годовой run-rate по месяцам
}
export type VerdictKey = 'on_track' | 'at_risk' | 'behind' | 'no_data'
export interface ModelResult {
  modelVersion: string; computedAt: string
  level: DataLevel; kind: ModelKind; template: TemplateKey
  gap: { baseAnnual: number | null; targetAnnual: number | null; absolute: number | null; multiplier: number | null; requiredCagrPct: number | null; months: number | null }
  forecast: { atCurrentPace: Range; trendMonthlyPct: number | null; basis: 'history' | 'insufficient' }
  verdict: { key: VerdictKey; headline: string; reason: string }
  scenarios: ScenarioResult[]          // пусто на уровне 0
  missing: MissingInput[]; warnings: string[]
}
// lib/point-b/model/compute.ts
export function computeModel(inputs: ModelInputs, profiles?: ScenarioProfile[]): ModelResult
```

---

### Task 1: Горизонты целей

**Files:**
- Create: `lib/point-b/horizons.ts`
- Test: `tests/unit/point-b/horizons.test.ts`

**Interfaces:**
- Produces: `horizonMonths(goal: { deadline: string | null; periodLabel: string; createdAt?: string | null; baselineAt?: string | null }, now: Date): number` (через `goalDeadline` из `lib/goals/evaluate.ts`, округление вверх, минимум 0); `pickPrimaryRevenueGoal(items: PlanGoalItem[]): PlanGoalItem | null` (главная цель плана → иначе выручка `12m` → иначе ближайшая по сроку цель выручки); `HORIZON_PRESETS: Array<{ label: string; periodLabel: string }>` (Месяц `1m`, Квартал `3m`, Год `12m`, 3 года `3y`); `isValidPeriodLabel(label: string): boolean` (`Nm`, `Ny`, `YYYY`, `YYYY-Qn`).

- [ ] **Step 1: Write the failing tests:** `'1m, 3m, 12m, 3y, 2025-Q2, 2027 convert to months from a fixed now'`; `'an explicit deadline overrides the label'`; `'a deadline in the past gives 0'`; `'pickPrimaryRevenueGoal prefers the plan primary, then revenue 12m, then the nearest deadline'`; `'isValidPeriodLabel accepts 6m, 2y, 2026-Q4 and rejects abc, 0m, 61m'` (потолок 60 мес.).
- [ ] **Step 2: Run** `npx vitest run tests/unit/point-b/horizons.test.ts` → FAIL.
- [ ] **Step 3: Implement** по сигнатурам (переиспользовать `goalDeadline`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): goal horizons — months, presets, primary revenue goal`.

### Task 2: Типы модели, входы и уровни данных

**Files:**
- Create: `lib/point-b/model/types.ts` (контракты выше), `lib/point-b/model/inputs.ts`, `lib/point-b/model/levels.ts`, `lib/point-b/model/history.ts`
- Test: `tests/unit/point-b/model-inputs.test.ts`

**Interfaces:**
- Produces:
  - `buildModelInputs(input: { pb: PointBInputs; history: ModelInputs['history']; template: TemplateKey; goals: PlanGoalsSnapshot | null; now: Date }): ModelInputs` — рычаги из `pb.metricOptions.metrics` (`POINT_B_LEVER_METRICS` + `biz.klienty.aktivnykh_klientov`, `biz.hr.kol_vo_sotrudnikov`; конверсия и повтор приводятся из процентов к долям), происхождение (`origin`) из источника метрики там, где оно известно, иначе `'fact'`; цель — главная цель выручки из `goals` (Task 1) с `reviewStatus`; без цели `goal: null`.
  - `determineLevel(i: ModelInputs): { level: DataLevel; kind: ModelKind; missing: MissingInput[] }` — **0**: нет цели или нет базовой выручки; **1 / funnel**: есть база и цель и лиды, конверсия, чек (повтор и активная база необязательны: активная база выводится как `leads × conversion × 12`, `origin: 'derived'`); **1 / growth**: база и цель есть, воронки нет (`template` не `ecommerce`/`services` либо нет рычагов); **2** — в Ф2 не выдаётся (Ф3). `missing` содержит для каждого недостающего входа: подпись, что он откроет, доступные действия (`survey`, `documents`, `expert`).
  - `templateKeyFor(industry: string | null): TemplateKey` — через `pickTemplate` из `lib/point-a/v4/config.ts`.
  - `loadRevenueHistory(sb: SupabaseClient, companyId: string): Promise<ModelInputs['history']>` — месячные факты метрики `biz.finansy.vyruchka_god` из `metric_facts` (период `YYYY-MM`, значения как месячная выручка; годовые/квартальные периоды не разворачиваются в месяцы), отсортировано по возрастанию; ошибка чтения → пустой список с логом.
- Consumes: `PointBInputs` (Ф0), `PlanGoalsSnapshot` (Ф1), `horizonMonths`/`pickPrimaryRevenueGoal` (Task 1).

- [ ] **Step 1: Write the failing tests:** `'levers are read from metrics and percent values become fractions'`; `'a goal without a base revenue is level 0 with missing base revenue'`; `'base, goal and funnel levers give level 1 funnel'`; `'no funnel metrics give level 1 growth with missing leads/conversion/check listed and unlocking text'`; `'active base is derived as leads × conversion × 12 and marked derived'`; `'no goal gives level 0 and missing goal with the survey and expert actions'`; `'goal review status is carried into ModelGoal.reviewStatus'`; `'templateKeyFor maps «Интернет-магазин» to ecommerce and unknown to default'`; `'loadRevenueHistory returns monthly facts sorted and skips quarterly and annual periods'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): model inputs, data levels and missing-input hints`.

### Task 3: Модель воронки

**Files:**
- Create: `lib/point-b/model/funnel.ts`
- Test: `tests/unit/point-b/model-funnel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FunnelParams { leads: number; conversion: number; avgCheck: number; repeat: number; activeBase0: number; seasonality: number[] /* 12 индексов, среднее 1 */; otherMonthly: number /* «прочая выручка» калибровки */ }
  export interface FunnelPath { leads: number[]; conversion: number[]; avgCheck: number[]; repeat: number[] } // по месяцам 1..H
  export function simulateFunnel(p: FunnelParams, path: FunnelPath, months: number): { revenue: number[]; orders: number[]; newCustomers: number[]; activeBase: number[] }
  export function calibrate(base: { revenueYear: number; params: Omit<FunnelParams, 'otherMonthly'> }): { otherMonthly: number; residualShare: number; ok: boolean }   // ok = |residualShare| ≤ 0.15
  export function seasonalityIndex(history: ModelInputs['history']): { index: number[]; defaulted: boolean }   // < 24 месяцев → 12 единиц, defaulted true; иначе средние по месяцам года, нормированные к среднему 1
  ```
- Формулы (спека §9.2): `N_t = L_t·c_t`; `B_t` = сумма `N` за последние 12 месяцев (до месяца 1 — по `activeBase0/12` в месяц); `Orders_t = N_t + B_{t-1}·R_t/12`; `Revenue_t = Orders_t·p_t·s_t + otherMonthly`. Калибровка: модель при базовых параметрах за 12 месяцев сравнивается с `revenueYear`; `otherMonthly = (revenueYear − model12)/12` при `|residualShare| ≤ 0.15`, иначе `ok: false`.

- [ ] **Step 1: Write the failing tests:** **золотой пример** — leads 300, conversion 0.12, avgCheck 185 000, repeat 0, activeBase0 0, seasonality 1 → `revenue[0]` = 36 · 185 000 = 6 660 000; та же модель с repeat 0.28 и activeBase0 = 432 даёт `orders[0]` = 36 + 432·0.28/12 = 46.08; `'calibrate: model equal to fact gives otherMonthly 0 and ok'`; `'residual 10% is absorbed into otherMonthly, 20% gives ok false'`; `'steady state: constant path gives constant revenue after the first 12 months'`; `'monotonic: raising leads never lowers revenue'`; `'zero path values give zero, never NaN'`; `'seasonalityIndex with < 24 months defaults to ones and flags defaulted'`; `'with 24 months of a seasonal pattern the index averages 1'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** чистые функции; валидация входов (отрицательные, `conversion > 1`, нулевой чек) через явную ошибку `ModelInputError` с текстом.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): funnel model with calibration and seasonality`.

### Task 4: Упрощённая модель роста

**Files:**
- Create: `lib/point-b/model/growth.ts`
- Test: `tests/unit/point-b/model-growth.test.ts`

**Interfaces:**
- Produces: `projectGrowth(input: { baseAnnual: number; annualGrowth: number; months: number }): number[]` — годовой run-rate по месяцам 1..months, `base·(1+g)^(t/12)`; `timeToTarget(input: { baseAnnual: number; targetAnnual: number; annualGrowth: number }): number | null` — месяцев до цели (`null`, если `annualGrowth ≤ 0` или цель ≤ базы → 0 при цели ниже базы); `requiredAnnualGrowth(base: number, target: number, months: number): number | null`.
- [ ] **Step 1: Write the failing tests:** `'base 60M, growth 100% annual, 12 months gives 120M'`; `'timeToTarget(60M, 120M, 1.0) = 12'`; `'timeToTarget with zero or negative growth is null'`; `'target below base gives 0 months'`; `'requiredAnnualGrowth(60M,120M,12) = 1'`, `'months ≤ 0 gives null'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): simplified growth model`.

### Task 5: Профили темпа, сценарии, диапазоны, прогноз и вердикт

**Files:**
- Create: `lib/point-b/model/profiles.ts`, `lib/point-b/model/scenarios.ts`, `lib/point-b/model/bands.ts`, `lib/point-b/model/forecast.ts`
- Test: `tests/unit/point-b/model-scenarios.test.ts`, `tests/unit/point-b/model-forecast.test.ts`

**Interfaces:**
- Produces:
  - `defaultProfiles(template: TemplateKey): ScenarioProfile[]` — три профиля: cautious `rampMonths 18, reserveMonths 3, productivityGain 0, growthCapAnnual 0.25`; moderate `12 / 2 / 0.05 / 0.5`; aggressive `6 / 1 / 0.1 / 1.0`; `leverMix` по шаблону (ecommerce: leads 0.35, conversion 0.25, avgCheck 0.15, repeat 0.25; services: 0.3 / 0.35 / 0.2 / 0.15; default/production: 0.25 каждому); `normalizeProfiles(input: unknown, template: TemplateKey): ScenarioProfile[]` — проверка пользовательских правок (диапазоны: `rampMonths` 1–36, `reserveMonths` 0–12, `growthCapAnnual` 0.05–3, `productivityGain` 0–0.5, `leverMix` неотрицательна и нормируется к 1; недопустимое → `ModelInputError`).
  - `volatilityBand(history: ModelInputs['history']): { delta: number; source: 'history' | 'default' }` — стандартное отклонение месячных приростов за последние ≥ 12 месяцев, ограничено 0.05–0.5; иначе `{ 0.2, 'default' }`.
  - `solveFunnelScenario(i: ModelInputs, profile: ScenarioProfile, season: number[], otherMonthly: number): ScenarioResult` и `solveGrowthScenario(i: ModelInputs, profile: ScenarioProfile): ScenarioResult` — решение по §9.4 спеки: общий требуемый множитель `G = targetAnnual / baseAnnual`; для воронки `ln G_i = w_i · ln G` (мультипликативные рычаги: leads, conversion, avgCheck; `repeat` повышает выручку через долю повторных заказов — его вклад подбирается численно бисекцией по `simulateFunnel` так, чтобы суммарный run-rate на конце темпа равнялся цели); рычаги растут линейно от нуля до целевого уровня за `rampMonths`; срок достижения — первый месяц, где месячная выручка (без сезонности) × 12 ≥ цель, без усреднения по трём месяцам (может превышать срок цели `months`, тогда `revenueAtDeadline < target`); потолок реализуемости рычага — `leads ≤ ×3`, `conversion ≤ min(1, ×2)` и не выше 0.6, `avgCheck ≤ ×2`, `repeat ≤ 0.9`; превышение → `feasible: false` + причина; диапазон — `ln G_eff = ln G · (1 ∓ delta)` для low/high (low — прирост меньше, поэтому срок больше); инвестиции: `marketingMonthlyIncrease = Δleads × CAC × conversion` если есть CAC, иначе `null` (+ пометка «нужен CAC»); `staffNeed = max(0, ceil(revenueAtGoal / (revenuePerEmployee0 · (1 + productivityGain))) − headcount)` если есть число сотрудников, иначе `null`; тексты `constraints / risks / conditions / downside / reviewPoints / signsToChangePace` — по правилам из профиля и данных (русские, без чисел, которых нет во входах); в `assumptions` всегда перечисляются использованные допущения (калибровка, сезонность по умолчанию, источник диапазона). Денежный риск помечается «кассовый разрыв не оценён: нет данных о деньгах (уровень 2)».
  - `projectCurrentPace(i: ModelInputs): { atCurrentPace: Range; trendMonthlyPct: number | null; basis: 'history' | 'insufficient' }` — тренд = средний месячный прирост между последними 6 и предыдущими 6 месяцами (нужно ≥ 12 месячных точек; иначе `insufficient`, диапазоны `null`); прогноз = база·(1+тренд)^(месяцев до срока), диапазон по `volatilityBand`.
  - `verdictFor(args: { goal: ModelGoal | null; forecast: Forecast; baseAnnual: number | null }): { key: VerdictKey; headline: string; reason: string }` — `no_data`, если нет прогноза или цели; `on_track` при `forecast.base ≥ 0.95·target`; `at_risk` при 0.8–0.95; `behind` ниже 0.8; `reason` называет числа прогноза и цели.
- Consumes: Tasks 2–4.

- [ ] **Step 1: Write the failing tests:** `'three profiles differ in ramp, reserve and growth cap, and leverMix sums to 1 for every template'`; `'normalizeProfiles rejects rampMonths 0 or 40 and normalises leverMix'`; `'cautious reaches the goal later than moderate, moderate later than aggressive (funnel golden: base 60M, goal 120M, 12 months)'`; `'every scenario trajectory is non-decreasing and low ≤ base ≤ high at every month'`; `'goal below the base revenue gives time 0 and no uplift'`; `'an uplift above a lever cap makes the scenario infeasible with a reason'`; `'no CAC gives marketingMonthlyIncrease null and the note asks for CAC'`; `'no headcount gives staffNeed null'`; `'identical inputs give identical results (determinism)'`; `'growth model: cap 25% annual cannot reach ×2 in 12 months, time-to-goal ≈ 37 months, revenueAtDeadline = base·1.25'`; `'volatilityBand defaults to 0.2 with fewer than 12 monthly points'`; `'projectCurrentPace is insufficient below 12 points and computed with 12 or more'`; `'verdict thresholds 0.95 / 0.8 and no_data without forecast or goal'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): scenario profiles, solver, bands, current-pace forecast and verdict`.

### Task 6: Оркестратор `computeModel` и золотые тесты

**Files:**
- Create: `lib/point-b/model/compute.ts`, `lib/point-b/model/index.ts` (реэкспорт публичного API)
- Test: `tests/unit/point-b/model-compute.test.ts`

**Interfaces:**
- Produces: `computeModel(inputs: ModelInputs, profiles?: ScenarioProfile[]): ModelResult` — определяет уровень (Task 2), собирает `gap`, `forecast`, `verdict`, `missing`, `warnings`; на уровне 0 — без сценариев; воронка: калибровка → при `ok: false` откат на упрощённую модель с предупреждением «расчёт по воронке не сходится с фактом на N%»; не бросает, ошибки валидации входов превращает в `warnings` и уровень 0. Предупреждения: устаревшая база (`stale`), цель ниже базы, цель в прошлом, срок > 60 месяцев, `reviewStatus` главной цели не `verified`/`agreed` («цель не проверена экспертом»), сезонность по умолчанию.
- [ ] **Step 1: Write the failing tests (golden + edge):** `'level 0 for no goal: gap null, scenarios [], missing lists goal'`; `'e-commerce golden: base 60M, goal 120M/12m, leads 300, conv 12%, check 185k gives level 1 funnel, 3 scenarios with strictly increasing speed'` (ожидаемые сроки считаются и фиксируются в тесте после первого корректного прогона вручную проверенной арифметики; проверка порядка и границ, не только значения); `'one golden for each template: ecommerce, services, production, default'`; `'a funnel not matching the fact by 25% falls back to growth with a warning'`; `'goal below base, goal in the past, months 0 and months 70 produce warnings and no throw'`; `'conversion 120% or check 0 gives level 0 with a warning, no NaN anywhere (JSON round-trip has no null from NaN)'`; `'stale base adds a warning and keeps the numbers'`; `'identity checks: scenarios[i].revenueAtDeadline.base ≤ target when time > months'`; `'ModelResult is JSON-serialisable and carries modelVersion pb-model-1'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): computeModel orchestrator with golden tests`.

### Task 7: Маршруты — расчёт сценариев и состояние страницы клиента

**Files:**
- Create: `app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/scenarios/route.ts` (POST пересчитать и сохранить; PATCH профили и выбранный сценарий), `app/api/v1/point-b/state/route.ts` (GET), `lib/point-b/model/load.ts`
- Modify: `lib/point-b/plan/store.ts` (метод `saveScenarios(sb, versionId, { scenarios, profiles, baseSnapshotId, selectedScenario? })` — только для черновика; `PlanError('not_editable')` иначе)
- Test: `tests/unit/point-b/routes-model.test.ts`

**Interfaces:**
- Produces:
  - `loadModelForCompany(sb, input: { userId: string; companyId: string | null; goals: PlanGoalsSnapshot | null; now?: Date }): Promise<{ inputs: ModelInputs; pb: PointBInputs }>` (в `load.ts`: `loadPointBInputs` + `loadRevenueHistory` + `templateKeyFor` из `companies.industry` + `buildModelInputs`).
  - `POST …/scenarios` `{ profiles? }` → считает `computeModel` с `normalizeProfiles`, сохраняет в черновик `scenarios` (массив `ScenarioResult`), `assumptions.profiles`, `base_snapshot_id`; ответ `{ ok, data: { result: ModelResult } }`. Права: `clients.review` + `guardClientAccess`/`forbidTarget`; аудит `point_b.scenarios.computed`; 409 `not_editable` для не-черновика; 400 `ModelInputError`.
  - `PATCH …/scenarios` `{ selectedScenario: 'cautious' | 'moderate' | 'aggressive' | null }` — выбор темпа в черновике (аудит `point_b.scenario.selected`).
  - `GET /api/v1/point-b/state` → `{ ok, data: { access: 'ok', overview: { result: ModelResult /* предварительный расчёт, всегда */; labelledAutomatic: true }, plan: { status: 'none' | 'preparing' | 'published'; version: number | null; selectedScenario: string | null; scenarios: ScenarioResult[] /* только одобренной версии, иначе [] */; approvedAt: string | null; authorName: string | null } } }`; идентичность из сессии, гейт `point_b` (402), «от имени» читает, не пишет; пользователь без компании/цели → `result` уровня 0 (не 500).
- Consumes: Tasks 2, 5, 6; `store.ts`, `route-guard.ts` (Ф1), `compat.ts` (Ф1) для статуса плана.

- [ ] **Step 1: Write the failing tests:** `'POST scenarios stores results into the draft and returns the ModelResult'`; `'POST on an in_review or approved version → 409'`; `'expert of another client → 403'`; `'invalid profile (rampMonths 0) → 400'`; `'PATCH selectedScenario accepts only the three keys'`; `'state: client sees scenarios only from the approved version (draft and in_review never leak)'`; `'state: no company → level 0 result, plan none'`; `'state: free tier with gates on → 402'`; `'state never writes'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/unit/point-b tests/unit/api` → PASS.
- [ ] **Step 5: Commit** `feat(point-b): scenario recompute route for experts and client state route`.

### Task 8: Клиент — «Обзор» и «Сценарии»

**Files:**
- Create: `components/point-b/tabs/PointBTabs.tsx`, `OverviewTab.tsx`, `ScenariosTab.tsx`, `components/point-b/DataGapBanner.tsx`, `StaleBaseBanner.tsx`, `CorridorChart.tsx`, `components/point-b/overviewModel.ts` (чистая логика отображения), `components/point-b/usePointBState.ts`
- Modify: `components/point-b/PointBContainer.tsx` (оболочка: вкладки «Обзор» · «Сценарии» · «Подробности»; «Подробности» = существующее содержимое `PointBView` без изменений), `app/dev/point-b-preview/page.tsx` (+ `lib/point-b/fixtures.ts` вариант модели `fixtureModelResult(variant)`)
- Test: `tests/unit/point-b/overview-ui.test.ts`

**Interfaces:**
- Consumes: `GET /api/v1/point-b/state` (Task 7), `ModelResult`/`ScenarioResult` (контракты), `PlanWorkflowSection` (Ф1).
- Поведение (спека §15): **Обзор** — вердикт-полоса (`on_track` / `at_risk` / `behind` / `no_data` с причиной), «Сейчас → Цель → Прогноз при текущем ходе (диапазон) → Разрыв», карточки целей по горизонтам с подписью срока, траектория `CorridorChart` (коридор low–high, линия базы, цель отмечена; на уровне 0 — честная заглушка), баннер «Данных мало» (`missing`: подпись, что откроется, кнопки «Заполнить в анкете» → `/client/onboarding`, «Загрузить файл» → `/client/onboarding/documents`, «Попросить эксперта» → `/client/messages`), `StaleBaseBanner` вверху при `warnings` об устаревшей базе, пометка «автоматический расчёт, не проверен экспертом»; **Сценарии** — если `plan.scenarios` пусты: «Эксперт готовит сценарии» + что нужно владельцу; иначе три карточки темпа (выбранный отмечен) + таблица сравнения (срок и выручка к сроку с диапазонами, прирост рычагов, инвестиции, персонал, ограничения, риски, условия успеха, последствия, точки пересмотра, признаки смены темпа — группы раскрываются), `feasible: false` показывается явной плашкой, «Выбрать темп» — не в Ф2 (выбор у эксперта); дизайн — токены, мобильная версия: вкладки прокручиваются, таблица становится списком карточек; на странице без PRO — как в Ф1 (`PointBPaywall`); ошибка секции локальна.
- [ ] **Step 1: Write the failing tests** (по подходу pop-up слоя: контроллер без React + `renderToStaticMarkup`; `.test.ts`): `'overviewModel maps verdict keys to Russian headline and tone'`; `'level 0 shows the placeholder instead of the chart and lists missing inputs with three actions'`; `'stale warning renders the banner at the top'`; `'corridor chart gets low ≤ base ≤ high points and a target line, no NaN in the SVG path'`; `'scenarios tab without scenarios shows the preparing text; with scenarios shows three cards and a comparison table; infeasible scenario is flagged'`; `'tabs: Подробности renders the legacy view untouched'`; `'automatic-calculation label is present on the overview'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit -p .`, eslint.
- [ ] **Step 5: Commit** `feat(point-b): client overview and scenarios tabs`.

### Task 9: Эксперт — расчёт и правка сценариев в черновике

**Files:**
- Create: `components/giga-panel/user360/point-b/ScenariosPanel.tsx`, `scenariosController.ts`
- Modify: `components/giga-panel/user360/point-b/PlanPanel.tsx` (встроить панель для черновика)
- Test: `tests/unit/point-b/scenarios-panel.test.ts`

**Interfaces:**
- Consumes: `POST/PATCH …/plan/versions/:versionId/scenarios` (Task 7), `ModelResult`.
- Поведение: кнопка «Рассчитать сценарии» (запрос, состояние загрузки, ошибки 400/409 текстом сервера); результаты трёх сценариев в таблице (срок, выручка к сроку с диапазонами, прирост рычагов, инвестиции, персонал, `feasible`); форма профиля темпа на сценарий (срок выхода, потолок роста, прирост производительности, доли вклада рычагов с автонормировкой, значения по умолчанию из шаблона и валидация диапазонов Task 5); «Выбрать темп для плана» (PATCH); подсветка `missing` и `warnings`; только для версии в статусе `draft` (в остальных статусах — режим чтения).
- [ ] **Step 1: Write the failing tests:** `'recompute posts profiles and shows the three results'`; `'profile form validates ranges and normalises the lever mix to 100%'`; `'select pace sends selectedScenario'`; `'server 400/409 messages are shown'`; `'read-only for in_review and approved versions'`; `'warnings and missing inputs are listed'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(point-b): expert scenario calculation and pace selection in the plan draft`.

### Task 10: Закрытие фазы

- [ ] **Step 1:** полный `npx vitest run`, `npx tsc --noEmit -p .`, eslint по изменённым файлам; допустимы только известные падения окружения.
- [ ] **Step 2:** визуальная проверка на фикстуре: `/dev/point-b-preview?variant=full|no-goal|stale-base` — вкладки, баннеры, график с коридором на десктопе и 375 px (без горизонтального переполнения); записать итог в `docs/superpowers/specs/2026-10-18-point-b-visual-audit.md` (раздел «После Ф2»).
- [ ] **Step 3:** отправка в main, ожидание деплоя `aistart360app-portal`, `curl`: `/api/v1/point-b/state` → 401 без сессии; миграций в Ф2 нет; обновить память проекта; написать план Ф3.

## Порядок выполнения

1 → 2 → 3 → 4 → 5 → 6 → 7 (Tasks 3 и 4 независимы друг от друга); Task 8 и Task 9 можно начинать после контрактов выше (мок `fetch`), не дожидаясь Task 7; Task 10 — последней.

## Self-Review (выполнено)

- **Покрытие спеки Ф2:** движок `model/*` (T2–T6); три профиля темпа, редактируемые экспертом (T5, T9); диапазоны (T5); реализуемость (T5); настраиваемые горизонты целей (T1; метки периодов и срок уже поддерживаются `metric_targets`/`goalDeadline`, UI постановки цели владельцем и экспертом остаётся существующим, расширение пресетами — `HORIZON_PRESETS` для Ф5/мастера целей); траектория с коридором, вердикт, баннер «Данных мало» (T8); сценарии клиенту только из одобренной версии (T7, T8). Не входит в Ф2: 19-й пункт сравнительной таблицы про деньги (резерв, нехватка, денежный поток) — Ф3; «выбрать темп» владельцем как предложение — Ф4/Ф6.
- **Типы:** `ModelInputs`, `ScenarioProfile`, `ScenarioResult`, `ModelResult` объявлены в контрактах и используются в T2–T9 без переименований; `computeModel` — единственная точка входа маршрутов.
- **Review Focus:** покрыт: воронка не сходится/нет воронки (T6), аномальные цели и входы (T3, T6), короткая история и устаревшая база (T5, T6, T8), потолки реализуемости (T5), видимость сценариев и чужие клиенты (T7).
- **Пропорции:** задачи — сигнатуры, правила, формулы из спеки и названия тестов; тел функций нет.
