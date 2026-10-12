# Точка А · Фаза 1: слой данных с учётом периодов. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Каждое значение метрики привязано к периоду и источнику. Резолвер выбирает значение по свежести периода, а внутри периода — по приоритету источника (анкета выше документа). Все наблюдения сохраняются как факты. Расхождения между источниками за один период, недопустимые значения и аномалии находятся автоматически и сохраняются.

**Spec:** `docs/superpowers/specs/2026-10-12-point-a-full-design.md` §1.

**Architecture:** Новый пакет `lib/data-layer/` из чистых функций:

- `survey-periods` — период ключа анкеты;
- `facts` — все наблюдения метрики по всем источникам;
- `normalize` — дубли, аномалии, свежесть;
- `reconcile` — расхождения;
- `sync` — тонкий слой ввода-вывода, который пишет `metric_facts` и `data_discrepancies` через service role.

Резолвер (`lib/metrics/resolver.ts`) и адаптеры (`source-adapters.ts`) дорабатываются точечно. Подключение — в `materializeAll`, этот путь проходят все пересчёты.

**Решение по хранению (уточнение к §1.1 спеки):** `public.metrics` остаётся таблицей «одно текущее значение на метрику». На этом инварианте держатся все читатели, `supersededMetricRowIds` и история через триггер в `metric_value_history`. Все наблюдения по периодам и источникам пишутся в новую таблицу `public.metric_facts`, которая полностью пересобирается при каждой материализации. Это тот же «вариант 1» (развить существующее) без поломки текущих читателей.

**Решение по валюте:** конвертации по курсу в фазе 1 нет (нет надёжного источника курсов). Значение в чужой валюте у ₸-метрики становится фактом с флагом `invalid` и попадает в расхождения с типом `invalid` — пользователь подтверждает сумму в ₸. Конвертация по курсу НБРК переносится в бэклог.

**Tech Stack:** TypeScript 5, Next.js 14 App Router, Supabase (service role + RLS), Vitest 4.

---

## Файлы

| Файл | Что | Новый/изм. |
|---|---|---|
| `lib/data-layer/types.ts` | `Fact`, `FactSourceKind`, `PeriodRef`, `DiscrepancyDraft` | новый |
| `lib/data-layer/period-key.ts` | `periodKey()`, `comparePeriods()`, `periodFromParts()` | новый |
| `lib/data-layer/survey-periods.ts` | `surveyKeyPeriod(key, answeredAt, now)` | новый |
| `lib/data-layer/facts.ts` | `collectFacts(ctx)` | новый |
| `lib/data-layer/normalize.ts` | `dedupeFacts`, `flagAnomalies`, `applyFreshness`, `normalizeFacts` | новый |
| `lib/data-layer/reconcile.ts` | `reconcile(facts, opts)` → `DiscrepancyDraft[]` | новый |
| `lib/data-layer/sync.ts` | `syncDataLayer(client, ctx)` — запись фактов и расхождений | новый |
| `lib/metrics/types.ts` | `ResolverContext.surveyAnsweredAt?` | изм. |
| `lib/metrics/materialize.ts` | читать `answered_at`; вызывать `syncDataLayer` после upsert | изм. |
| `lib/metrics/source-adapters.ts` | период у ответа анкеты; экспорт `documentCandidates()` | изм. |
| `lib/metrics/resolver.ts` | выбор: сначала свежий период, потом приоритет; анкета > документ; `periodYear` из победителя | изм. |
| `lib/metrics/company-metrics.ts` | `currentMetricRows` с учётом периода, ранг анкета > документ | изм. |
| `lib/events/platform-names.ts` | новые события | изм. |
| `lib/metrics/materialize-tenant.ts` | отправка `METRIC_UPDATED` | изм. |
| `app/api/v1/onboarding/survey/route.ts` | отправка `SURVEY_ANSWER_CHANGED` | изм. |
| `app/api/v1/onboarding/documents/[id]/route.ts` | `DOCUMENT_DELETED` + фоновая перематериализация | изм. |
| `app/api/v1/data/discrepancies/route.ts` | GET список открытых расхождений | новый |
| `app/api/v1/data/discrepancies/[id]/resolve/route.ts` | POST решение | новый |
| `supabase/migrations/110_data_layer_facts_discrepancies.sql` | таблицы + RLS | новый |
| `tests/unit/data-layer/*.test.ts` | юнит-тесты | новые |

---

### Task 1: Ключ периода и сравнение периодов

**Files:** создать `lib/data-layer/types.ts`, `lib/data-layer/period-key.ts`, `tests/unit/data-layer/period-key.test.ts`.

```ts
// types.ts
export type FactSourceKind = 'survey' | 'document' | 'manual' | 'integration' | 'assessment'
export interface PeriodRef { year: number; quarter: 1|2|3|4|null; month: number|null } // month 1..12
export type FactFlag = 'invalid' | 'anomaly' | 'stale' | 'rescaled' | 'confirmed'
export interface Fact {
  metricId: string
  period: PeriodRef | null          // null = период неизвестен
  periodKey: string                 // '2024' | '2024-Q2' | '2024-03' | 'unknown'
  value: number
  unit: string
  sourceKind: FactSourceKind
  sourceRef: string                 // 'survey:s9n_revenue_2024' | 'document:<id>#<field>' | 'manual' | 'integration:<provider>'
  sourceRefs: string[]              // после схлопывания дублей
  confidence: number                // 0..1
  flags: FactFlag[]
  observedAt: string | null         // answered_at / uploaded_at / fetched_at
  note?: string
}
export type DiscrepancyKind = 'conflict' | 'invalid' | 'anomaly'
export interface DiscrepancyCandidate { value: number; unit: string; sourceKind: FactSourceKind; sourceRef: string; confidence: number }
export interface DiscrepancyDraft { metricId: string; periodKey: string; kind: DiscrepancyKind; candidates: DiscrepancyCandidate[]; chosenValue: number | null; detail: string }
```

```ts
// period-key.ts
export function periodKey(p: PeriodRef | null): string          // null → 'unknown'; month → 'YYYY-MM'; quarter → 'YYYY-Qn'; else 'YYYY'
export function periodOrdinal(p: PeriodRef | null): number | null // конец периода в месяцах: year*12 + (month ?? quarter*3 ?? 12)
export function periodFromParts(year?: number|null, quarter?: string|number|null, month?: number|null): PeriodRef | null
```

Тесты:
- `periodKey({year:2024,quarter:null,month:null})` → `'2024'`;
- `{2024, quarter 2}` → `'2024-Q2'`;
- `{2024, month 3}` → `'2024-03'`;
- `null` → `'unknown'`;
- `periodOrdinal`: 2024 > 2024-Q3 > 2024-03;
- `periodFromParts(2025,'Q1',null)` → `{2025,1,null}`, а `periodFromParts(null)` → `null`.

- [ ] Написать тесты, увидеть FAIL, реализовать, увидеть PASS: `npx vitest run tests/unit/data-layer/period-key.test.ts`.
- [ ] Commit `feat(data-layer): period keys`.

### Task 2: Период ключа анкеты

**Files:** `lib/data-layer/survey-periods.ts`, `tests/unit/data-layer/survey-periods.test.ts`.

```ts
export interface SurveyPeriod { period: PeriodRef; basis: 'key' | 'answered' }
/** Год в ключе (`_2024`, `_2023` в конце или перед `_`) → тот год; `vs_YYYY` — сравнение с YYYY, значение относится к YYYY+1;
 *  иначе ответ описывает текущую ситуацию → год answeredAt (или now). */
export function surveyKeyPeriod(key: string, answeredAt: string | null | undefined, now: Date): SurveyPeriod
```

Правила и тесты:
- `s9n_revenue_2024` → 2024, basis `key`;
- `s2_revenue_2025` → 2025;
- `s2_new_clients_2024` → 2024;
- `s9n_change_vs_2023` → 2024, basis `key`;
- `s9n_net_profit`, answeredAt `2026-03-05` → 2026, basis `answered`;
- `s9n_net_profit`, answeredAt null, now 2026-10-12 → 2026;
- `s8n_metrics_table` → текущий год;
- ключ с числом, не похожим на год (`s7_repeat_freq_days`), → текущий год;
- год вне диапазона 2000..now+1 не считается годом.

- [ ] Тесты → FAIL → реализация → PASS.
- [ ] Commit `feat(data-layer): survey key periods`.

### Task 3: Время ответов анкеты в контексте резолвера

**Files:** `lib/metrics/types.ts` (добавить `surveyAnsweredAt?: Record<string, string>` в `ResolverContext`), `lib/metrics/materialize.ts` (`gatherResolverContext`: `select('question_key, answer, answered_at')` и заполнить карту). Тест в `tests/unit/metrics/materialize-inputs.test.ts`: мок supabase возвращает `answered_at` → `ctx.surveyAnsweredAt[key]` установлен.

- [ ] Тест → реализация → `npx vitest run tests/unit/metrics/materialize-inputs.test.ts` PASS.
- [ ] Commit.

### Task 4: Период у ответа анкеты в резолвере

**Files:** `lib/metrics/source-adapters.ts` (`resolveSurveySource`, `resolveCompositeSurveySource`).

У каждого успешного ответа (`status = 'hit'`) анкеты появляется `period.year` из `surveyKeyPeriod(key, ctx.surveyAnsweredAt?.[key], ctx.now)`. Если `period` уже был (масштабирование), год добавляется к нему. Если не было, создаётся `{source: null, target: shape.period ?? null, factor: 1, year, quarter: null, month: null, basis: 'answer'}`.

Тест в `tests/unit/metrics/survey-coercion.test.ts`: `s9n_revenue_2024` → `attempt.period.year === 2024`; ключ без года с answeredAt 2026 → 2026.

- [ ] Тест → реализация → полный прогон `npx vitest run tests/unit/metrics tests/unit/point-a`. Ожидания других тестов, которые сравнивают attempt целиком, обновлять только если меняется лишь добавленное поле `period`.
- [ ] Commit.

### Task 5: Выбор значения: сначала свежий период, потом приоритет

**Files:** `lib/metrics/resolver.ts`.

1. `SOURCE_PRIORITY.survey` = 85 (выше document 80; manual 100). Устаревшие ключи анкеты остаются на 62.
2. Выбор победителя:
   - `Ymax` — максимальный `periodOrdinal` среди успешных попыток с известным годом;
   - успешные попытки с известным периодом меньше `Ymax` отбрасываются; попытки без периода (формула, GRI, prisma) остаются;
   - среди оставшихся побеждает больший `priority`, затем больший `confidence`.
3. `MetricValue.periodYear` и `periodQuarter` берутся из `picked.period` (если есть), иначе из `ctx.preferPeriodYear`.

Тесты в `tests/unit/metrics/resolver.test.ts` (новый describe «period-aware pick»):
- анкета 2024 = 10 млн, документ 2025 = 14 млн → 14 млн, `periodYear` 2025;
- анкета без года (текущий 2026) = 10 млн, документ 2025 = 14 млн → 10 млн, 2026;
- анкета 2024 = 10 млн, документ 2024 = 14 млн → 10 млн (анкета главнее в том же периоде);
- manual всегда побеждает в своём периоде.

- [ ] Тесты → FAIL → реализация → полный прогон метрик и Точки А. Каждое изменённое ожидание в существующих тестах объяснить в коммите. Это намеренное изменение правила «документ > анкета» по решению PO.
- [ ] Commit `feat(metrics): period-first pick, survey above document within a period`.

### Task 6: Все кандидаты из документов

**Files:** `lib/metrics/source-adapters.ts`.

Цикл по документам и полям из `resolveDocumentSource` выносится в экспортируемую `documentCandidates(source, ctx, metricId, shape): { candidates: DocCandidateOut[]; rejected: string[] }`. `resolveDocumentSource` вызывает её и сортирует. Тип `DocCandidateOut`: `{ documentId, docType, fieldKey, fieldLabel, numeric, confidence, detected: DetectedPeriod|null, factor, uploadedAt }`. Поведение `resolveDocumentSource` не меняется: тесты `document-sources.test.ts` остаются зелёными.

- [ ] Тест: 2 документа (2024 и 2025) с выручкой → 2 кандидата с правильными годами.
- [ ] Commit.

### Task 7: `collectFacts`

**Files:** `lib/data-layer/facts.ts`, `tests/unit/data-layer/facts.test.ts`.

`collectFacts(ctx: ResolverContext): Fact[]`. Для каждой метрики реестра (`getMetricRegistry()`) и каждого источника:

- **survey** (кроме устаревших ключей, если для метрики есть текущий): `resolveSurveySource`, при `hit` → факт с периодом из Task 2, `sourceRef = survey:<key>`, `observedAt = answeredAt`;
- **document**: `documentCandidates` → факт на каждого кандидата. Период берётся из `detected` (год, квартал, месяц), `periodKey` — по периоду **исходного** значения, а не масштабированного. `value` = numeric (уже приведён к периоду метрики), флаг `rescaled`, если factor ≠ 1;
- **manual** / **external integration** / **assessment**: `tryResolveSource`, при `hit` → факт (integration — период из `external.period_end`, остальные — текущий год);
- формулы и prisma фактами не являются.

Отклонения проверки правдоподобия (`isPlausibleFor` = false) превращаются в факт с флагом `invalid`, а не отбрасываются. Отклонения по валюте (`miss` «value is in $») — тоже факт с флагом `invalid` и `note`.

Тесты: анкета 2024 + документ 2024 + документ 2025 → 3 факта по выручке, ключи периодов `2024`, `2024`, `2025`; маржа 140% → факт с флагом `invalid`; пустой контекст → `[]`.

- [ ] Тесты → реализация → PASS. Commit.

### Task 8: Нормализация

**Files:** `lib/data-layer/normalize.ts`, `tests/unit/data-layer/normalize.test.ts`.

- `dedupeFacts(facts)`: в группе (metricId, periodKey) значения из разных источников, отличающиеся не больше чем на 0.5%, схлопываются в один факт: источник с наибольшим приоритетом (manual > survey > document > integration > assessment), `sourceRefs` = все, `confidence = min(1, max + 0.1)`, флаг `confirmed`.
- `flagAnomalies(facts)`: по метрике (без `invalid`) берётся ряд по периодам. Если точек ≥ 4: робастный z = 0.6745·|x − median| / MAD > 3.5 → флаг `anomaly`, `confidence *= 0.7`. Если точек 2–3: |x / median| > 3 или < 1/3 → `anomaly`.
- `applyFreshness(facts, now, staleMonths = 6)`: факты анкеты с `basis answered` (текущая ситуация), у которых `observedAt` старше `staleMonths`, получают флаг `stale` и `confidence *= 0.8`. Исторические периоды не затухают.
- `normalizeFacts = applyFreshness ∘ flagAnomalies ∘ dedupeFacts`.

Тесты на каждую функцию, включая граничные случаи (ровно 0.5%, MAD = 0).

- [ ] Тесты → реализация → PASS. Commit.

### Task 9: Сверка

**Files:** `lib/data-layer/reconcile.ts`, `tests/unit/data-layer/reconcile.test.ts`.

`reconcile(facts, { threshold?: (metricId) => number })`, порог по умолчанию 0.05:

- **conflict:** в группе (metricId, periodKey ≠ 'unknown') есть ≥ 2 фактов из разных `sourceKind` (или разных документов) без флага `invalid`, и `(max − min) / max(|max|, ε) > threshold` → черновик с кандидатами (сортировка по приоритету); `chosenValue` — значение по приоритету;
- **invalid:** каждый факт с флагом `invalid` → черновик с одним кандидатом, `chosenValue = null`;
- **anomaly:** каждый факт с флагом `anomaly` → черновик.

Тесты:
- анкета 2024 10 млн и документ 2024 14 млн → 1 conflict, chosen 10 млн;
- анкета 2026 10 млн и документ 2025 14 млн → 0;
- разница 3% → 0;
- два документа 2024 с разными значениями → conflict;
- invalid → 1 запись.

- [ ] Тесты → реализация → PASS. Commit.

### Task 10: Миграция 110

**Files:** `supabase/migrations/110_data_layer_facts_discrepancies.sql`.

```sql
CREATE TABLE IF NOT EXISTS public.metric_facts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  period_year INT, period_quarter SMALLINT, period_month SMALLINT,
  value NUMERIC(24,6) NOT NULL,
  unit TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('survey','document','manual','integration','assessment')),
  source_ref TEXT NOT NULL,
  source_refs TEXT[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  flags TEXT[] NOT NULL DEFAULT '{}',
  observed_at TIMESTAMPTZ,
  note TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metric_facts_company_metric_idx ON public.metric_facts (company_id, metric_key, period_key);

CREATE TABLE IF NOT EXISTS public.data_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('conflict','invalid','anomaly','missing_period')),
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  chosen_value NUMERIC(24,6),
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved_user','resolved_expert','ignored','auto_resolved')),
  resolved_by TEXT, resolution_value NUMERIC(24,6), resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS data_discrepancies_one_open
  ON public.data_discrepancies (company_id, metric_key, period_key, kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS data_discrepancies_company_idx ON public.data_discrepancies (company_id, status, created_at DESC);
-- updated_at trigger, RLS: SELECT через public.can_read_company(company_id); INSERT/UPDATE/DELETE отозваны у anon/authenticated (пишет только service role)
```

- [ ] Написать миграцию (с триггером `set_updated_at`, RLS, `NOTIFY pgrst`).
- [ ] Commit. **Применение к проду — отдельный шаг с подтверждением пользователя** (`node scripts/apply-migration.js`).

### Task 11: `syncDataLayer` и подключение к материализации

**Files:** `lib/data-layer/sync.ts`, `lib/metrics/materialize.ts`, `tests/unit/data-layer/sync.test.ts`.

`syncDataLayer(client, ctx): Promise<{ facts: number; opened: number; autoResolved: number; error: string | null }>`:

1. `facts = normalizeFacts(collectFacts(ctx), ctx.now)`.
2. Удалить `metric_facts` компании и вставить новые факты пачками по 500.
3. `drafts = reconcile(facts)`. Прочитать открытые расхождения компании:
   - черновик без открытой записи → INSERT;
   - открытая запись с тем же ключом → UPDATE `candidates` / `chosen_value` / `detail`;
   - открытая запись без черновика → `status = 'auto_resolved'`, `resolved_at = now`.
4. Решённые записи (`resolved_*` / `ignored`) не переоткрываются, если кандидаты не изменились (сравнение множества значений `candidates`). Если изменились — создаётся новая запись `open`.
5. Ошибка таблицы `42P01` (миграция ещё не применена) — тихий возврат `error: 'not_migrated'`.

Вызов в `materializeAll` после успешного upsert; ошибка записывается в `errors` как `'*data-layer'`, но материализацию не валит.

Тест с фейковым supabase (паттерн из `tests/unit/metrics/materialize-prune.test.ts`): новые расхождения вставляются, исчезнувшие получают `auto_resolved`, решённые не переоткрываются.

- [ ] Тест → реализация → PASS. Commit.

### Task 12: Текущее значение с учётом периода

**Files:** `lib/metrics/company-metrics.ts`, `tests/unit/metrics/*` (найти тест `currentMetricRows`, иначе создать `tests/unit/metrics/company-metrics.test.ts`).

`currentMetricRows`: сначала больший `periodOrdinal(period_year, period_quarter, period_month)` (строки без периода считаются равными любому периоду и сравниваются дальше), затем ранг источника (`manual 7, survey 6, document 5, calculated 4, prisma 3, external 2, resolver 1`), затем свежесть вычисления.

Тесты: строка 2025 побеждает строку 2024 независимо от `computed_at`; в одном периоде анкета побеждает документ.

- [ ] Тест → реализация → PASS. Commit.

### Task 13: События

**Files:** `lib/events/platform-names.ts`, `lib/metrics/materialize-tenant.ts`, `app/api/v1/onboarding/survey/route.ts`, `app/api/v1/onboarding/documents/[id]/route.ts`.

- Новые события: `SURVEY_ANSWER_CHANGED` «Анкета изменена», `DOCUMENT_DELETED` «Документ удалён», `DISCREPANCY_FOUND` «Найдено расхождение в данных», `DISCREPANCY_RESOLVED` «Расхождение закрыто», `TARGET_CHANGED` «Цель изменена», `BLOCK_CONFIG_CHANGED` «Конфигурация блоков изменена», `POINT_A_UPDATED` «Точка А обновлена».
- `materializeForTenant`: после записи, если `written > 0`, отправить `METRIC_UPDATED` (dedupe `metric_updated:<company>:<минута>`). Если `opened > 0`, отправить `DISCREPANCY_FOUND`.
- Сохранение анкеты: `SURVEY_ANSWER_CHANGED` (dedupe `survey_changed:<company>:<минута>`, payload: ключи).
- Удаление документа: `DOCUMENT_DELETED` и `runInBackground('rematerialize', …materializeForTenant)`, чтобы факты удалённого документа отозвались сразу.
- Тест: `isPlatformEventName('DOCUMENT_DELETED')`; у всех событий есть подписи (labels).

- [ ] Реализация → тесты → Commit.

### Task 14: API расхождений

**Files:** `app/api/v1/data/discrepancies/route.ts`, `app/api/v1/data/discrepancies/[id]/resolve/route.ts`, `tests/unit/api/data-discrepancies.test.ts`.

- **GET `?status=open`**: tenant из сессии (`resolveTenant*` как в `app/api/v1/metrics/materialize/route.ts`), чтение через сессию (RLS), сортировка по `created_at desc`.
- **POST resolve**, тело `{ choice: 'candidate', index } | { choice: 'custom', value, note? } | { choice: 'ignore' }` (zod):
  1. проверить, что расхождение принадлежит компании пользователя (service client + `company_id` из tenant);
  2. для `candidate` или `custom` записать ручное значение метрики через существующий механизм ручных правок. Если механизма нет — upsert строки `metrics` с `source = 'manual'`, периодом из `period_key`, `provenance: {discrepancy_id, by}`;
  3. статус `resolved_user`, или `resolved_expert` для staff/эксперта;
  4. запись в аудит, если есть хелпер аудита GIGA;
  5. `DISCREPANCY_RESOLVED`;
  6. фоновая перематериализация.
- Тесты: чужой `company_id` → 404; неверное тело → 400; `ignore` → статус `ignored`.

- [ ] Найти механизм ручных правок (`manualOverrides`, grep). Реализация → тесты → Commit.

### Task 15: Проверка фазы

- [ ] `npx vitest run` — весь набор зелёный (или падают только известные тесты, зависящие от окружения; см. память `aistart360-test-env`).
- [ ] `npx tsc --noEmit` — 0 ошибок.
- [ ] `npm run lint` — 0 ошибок.
- [ ] Ревью диффа субагентом-ревьюером.
- [ ] Отчёт пользователю: что сделано, какие тесты изменились и почему, что требует применения миграции.
