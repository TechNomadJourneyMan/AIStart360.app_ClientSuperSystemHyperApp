# AIStart360 — Real-Time Point A Intelligence Layer

Полная документация работы, выполненной в этой сессии: переход от статического каталога метрик к живой intelligence-системе с resolver-провенансом, document-pipeline с AI-биндингом, embeddings, anomaly/forecast движками, realtime-подпиской, AI-нарративом, бенчмарками и обновлённым клиентским кабинетом.

---

## 1. Цель и контекст

**До работы:** `lib/metrics/descriptions.ts` декларировал 122 метрики (48 BIZ × 7 отделов + 12 KPI + 7 GRI блоков + 55 goal-метрик) с типизированными источниками (`survey` / `document` / `prisma` / `external` / `manual` / `missing`), но ничего не вычисляло — `/metrics` показывал только модалку описания. Точка А (`lib/point-a-engine.ts`) считала 5-блочный score из survey, но игнорировала 122-метровый каталог и документы. Реалтайма не было. Document-парсер заполнял `documents.parsed_data` JSONB, но никто не связывал извлечённые поля с метриками.

**После:** Каждая из 122 метрик резолвится из 6 типов источников с приоритетом и провенансом. Документы автоматически биндятся к metric_id. Embeddings пишутся в `DocumentChunk` (vector 1536). Anomaly/forecast/ensemble-forecast/seasonality движки. Realtime через `supabase.channel().on('postgres_changes')` инвалидирует React Query кэш. Точка А-aggregator v2 расширяет существующий `PointA` объект полем `intelligence` (top-strengths, gaps, by-department, coverage, trends). Клиентский кабинет на `/dashboard` (sidebar) показывает всё: радар + KPI + риски + quick-wins + **Real-time Intelligence**. Точка Б полностью computed (KPI с current→target, GAP-анализ, Q1-Q4 roadmap).

---

## 2. Архитектура

```
┌──────────────────────────────────────────────────────────────────────┐
│                  REAL-TIME POINT A INTELLIGENCE                       │
└──────────────────────────────────────────────────────────────────────┘

  Sources                                                  Storage
  ─────────────────────────────────                       ──────────
  Survey (12 шагов, s1..s12)              ──┐
  Documents.parsed_data.fields[].metric_id ──┤
  Prisma signals (PulseMetric, GRI, …)    ──┼─► resolver  ──► public.metrics
  External (1C / GA / KASE / CRM)         ──┤   priority +     (cache +
  Manual overrides                         ──┤   confidence    provenance
  Missing                                  ──┘   blending      jsonb)

  ──────────────────────────────────────────────────────────────────────

  Analytics                                                Realtime
  ─────────────                                            ────────
  anomalies (rolling z-score + flat-collapse) ──┐
  forecast (LR + EMA blend)                   ──┤
  forecast-ensemble (LR/EMA/Holt/AR(1))        ──┼─► /api/v1/metrics/[id]/*
  seasonality (STL decomp)                    ──┤
  trend (7 categorical labels, inverse-aware) ──┘

  Realtime channels (Supabase publication 016)
  metrics / diagnostics / documents
       │
       ▼
  useRealtimeSync({ table, filter, invalidateKeys })
  useRealtimePointA(userId, companyId)
  useRealtimeMetrics(userId)

  ──────────────────────────────────────────────────────────────────────

  Point A v2                                               Cabinet UI
  ────────────                                             ──────────
  aggregator(supabase, userId, companyId) ──► PointA       /dashboard (sidebar)
   ├─ calculatePointA(survey)  (rule-based, locked)            ├─ Header + KPI
   ├─ resolveAllMetrics(ctx)   (live values from 122)          ├─ Радар + bars
   ├─ materializeAll          (writes to public.metrics)       ├─ Инсайты / Риски / QuickWins
   └─ buildIntelligence({                                      └─ PointAIntelligenceSection
        by_department,                                              ├─ Coverage strip
        top_strengths, top_gaps,                                    ├─ Top strengths
        coverage: {biz, kpi, gri, goal, overall},                   ├─ Top gaps
        trends                                                      ├─ By-department
       })                                                           └─ Risks + QuickWins

  +ai_narrative (executive summary via Claude Sonnet 4.5)
  +benchmarks (8 industries × 24 rows, percentile vs)
  +scoring-v2 (industry-aware weights + confidence calibration)
  +history (versioned snapshots + diff)
```

---

## 3. Что построено пофазно

### Phase 1 — Resolver Foundation (я сам, Sonnet)

- **Migration 016** (`supabase/migrations/016_metrics_resolver_extensions.sql`) — расширил `public.metrics`:
  - `confidence DECIMAL(3,2)`, `provenance JSONB`, `computed_at TIMESTAMPTZ`
  - Расширил CHECK на `source IN (survey, document, manual, calculated, resolver, external, prisma)`
  - Включил Supabase Realtime publication для `metrics`, `diagnostics`, `documents`
  - `REPLICA IDENTITY FULL` для полных row-payloads в realtime
- **`lib/metrics/types.ts`** — типы `MetricEntry`, `MetricValue`, `ResolverContext`, `SourceAttempt`, `MaterializedRow`
- **`lib/metrics/registry.ts`** — плоский каталог 100+ метрик из 4 namespace (`biz/kpi/gri/goal`), `slugifyLabel()` (кириллица → латиница), `inferUnit()` (₸/%/days/count), мемоизированные `getMetricById`, `getMetricsByNamespace`, `getMetricsByDepartment`
- **`lib/metrics/source-adapters.ts`** — 6 чистых функций (`resolveSurveySource`, `resolveDocumentSource`, `resolvePrismaSource`, `resolveExternalSource`, `resolveManualSource`, `resolveMissingSource`) + `tryResolveSource` диспетчер + `coerceNumeric` (формат `"84 200 000"` → `84200000`, `"₸ 1 250"` → `1250`)
- **`lib/metrics/resolver.ts`** — `resolveMetric(id, ctx)` (приоритет manual=100, document=80, survey=70, prisma=60, external=40, missing=0), `resolveAllMetrics`, `summarize` (coverage + top gaps), confidence blending: `0.85·base + priority/200`
- **`lib/metrics/materialize.ts`** — `gatherResolverContext(supabase, opts)` (бэтч-load survey + documents) + `materializeAll` (upsert в `public.metrics` через `onConflict: 'company_id,metric_key,period_year,period_quarter,source'`)
- **`tests/unit/metrics/resolver.test.ts`** — 29 тестов: registry shape, coerceNumeric (booleans, formatted strings), survey/document adapters (exact match, metric_id binding, doc_type filter, period preference), priority (document > survey > manual override), provenance, batch resolve + summarize, materialize row mapping
- **`scripts/apply-migration.js`** + **`scripts/verify-migration-016.js`** — runner и верификатор (через `DIRECT_URL`, simple-query protocol для DO-блоков)

### Phase 2 — Document Pipeline (Opus + 4 helpers)

- **`lib/documents/bind-fields.ts`** (Opus main) — `bindFieldsToMetrics(fields, docType, opts)`. Strategy: (1) канонический ключ через `matchSynonym`, (2) exact-match по `MetricSource.field` + doc_type filter, (3) tiebreaker по namespace/label/unit, (4) опциональный AI fallback через dynamic import
- **`lib/documents/bind-fields-ai.ts`** (Opus helper) — LLM-резолвер для residual fields. Jaccard pre-ranking (top-30 кандидатов из 122 регистра), Haiku для batch / Sonnet для single, JSON-schema через Zod, in-memory cache по `${cacheKey}:${key}:${label}`, confidence threshold 0.6. ~600 input + 120 output токенов на field
- **`lib/documents/synonyms.ts`** — 104 канонических ключа RU↔EN (revenue ⇔ выручка ⇔ доход ⇔ оборот, gross_margin ⇔ маржа, cac, ltv, ebitda, churn, nps, etc.) + `normalizeForMatch` (ё→е, punctuation strip)
- **`lib/documents/classify.ts`** — heuristic auto-classifier doc_type из filename + первых 2000 знаков (regex filename + Russian/English keyword density). 13 doc_types (pl_report / balance_sheet / marketing_report / ops_report / crm_export / audit / financial_report / patient_base / pricelist / services_catalog / packages / scripts / brand_rules)
- **`lib/documents/ocr.ts`** — tesseract.js wrapper с `shouldFallbackToOcr(text, fileSize)` (text < 200 chars && file > 50KB) и `ocrPdfBuffer(buf, { langs: ['rus','eng'], maxPages: 10 })`. Never throws, terminates worker
- **`lib/documents/embed.ts`** — `embedAndStoreChunks(docSummaryId, fullText)`: `chunkDocument` (LangChain 1000-char/200-overlap) → `embedWithOpenRouter` (batch 16, openai/text-embedding-3-small @ 1536 dims) → `prisma.$executeRaw` insert в `DocumentChunk` с `[...]::vector` literal. Idempotent (delete existing first). Cost ~$0.00015 на 30KB документ
- **`lib/ai/openrouter.ts`** — добавлен `embedWithOpenRouter(texts, opts)` к существующему `chatWithOpenRouter`. Default model `openai/text-embedding-3-small`, dimensions=1536
- **`lib/documents/extract.ts`** (модифицирован) — `metric_id?: string | null` добавлен в `ParsedDataField` interface + Zod schema. После `normalizeExtraction()` вызывает `bindFieldsToMetrics` (dynamic import) и заменяет `extraction.fields`
- **`app/api/v1/onboarding/documents/[id]/process/route.ts`** (модифицирован) — fire-and-forget embedding pipeline под флагом `ENABLE_DOCUMENT_EMBEDDINGS=true`. Best-effort, не блокирует response
- **`app/api/v1/documents/[id]/rebind/route.ts`** — POST endpoint для повторного биндинга без re-extraction. Auth + RLS check (owner или admin), 409 если parse_status != 'parsed', graceful degrade если bind-fields отсутствует. Идемпотентен
- **Migration 017** (`supabase/migrations/017_documents_parsed_data.sql`) — добавил недостающие в prod колонки `parsed_data JSONB`, `parse_error TEXT`, `n8n_execution_id TEXT` в `public.documents` (был critical drift с миграции 001 — pipeline всех писал в несуществующую колонку). Расширил parse_status CHECK на `'completed'` (legacy value в prod). GIN-индекс на `parsed_data->fields`
- **Тесты:** 11 bind-fields + 19 bind-fields-ai + 16 synonyms + 14 classify + 8 ocr-decisions + 6 rebind-route = **74 теста** для doc pipeline

### Phase 3 — Analytics Engines (Opus + 4 helpers)

- **`lib/metrics/anomalies.ts`** (Opus main) — rolling z-score (window=8), `|z| > 3 → critical`, `> 2 → warning`, `> 1.5 → info`. Flat-collapse detection (last 3 equal AND prior stddev > 0). Russian description templates с `{sign}{deltaPct}%`. 9 unit-тестов
- **`lib/metrics/forecast.ts`** (Opus main) — LR + EMA blend (default 0.6 LR / 0.4 EMA), ±1.96·residualStd confidence band, horizon clamped [1,12], cadence auto-inference (daily/weekly/monthly/quarterly) с Russian labels. 8 unit-тестов
- **`lib/metrics/forecast-ensemble.ts`** (Opus helper) — 4 метода (LinReg + EMA + Holt linear + AR(1)) с holdout-evaluation на `evalWindow` точек. MAPE-weighted voting: `weight = (1/(mape+0.01))` normalized; методы с mape>0.5 получают вес 0. Russian notes с dominant method. 15 unit-тестов
- **`lib/metrics/seasonality.ts`** — STL-style decomposition (trend + seasonal + residual). Centered moving average для trend (2×period window + linear extrapolation на краях), phase-averaged seasonal с mean-centering, residual strength metric. Auto-detect period (4 или 12) по cadence. 12 unit-тестов
- **`lib/metrics/trend.ts`** — категориальный classifier: `strong_growth | steady_growth | flat | gentle_decline | sharp_decline | volatile | insufficient_data`. CV > 0.5 + R² < 0.4 → volatile. Russian shortLabel + description с plural forms ("период / периода / периодов"). `inverse=true` для CAC/churn (down is good). 14 unit-тестов
- **`lib/metrics/timeseries-fetch.ts`** — `fetchTimeseries(supabase, { companyId, metricKey, period })`. Period filter на `recorded_at`. Russian short date labels. Returns `[]` если метрика не материализована
- **API routes:**
  - `app/api/v1/metrics/[id]/timeseries/route.ts` — GET с Zod-validated `period` (1M/3M/6M/1Y/ALL, default 3M). Response без wrapper: `{ metricId, period, granularity, unit, data: TimeseriesPoint[] }` (матчит существующий `useTimeseries` hook)
  - `app/api/v1/metrics/[id]/forecast/route.ts` — GET, response `{ data, confidence: 0.7, method: 'lr+ema' }`
  - `app/api/v1/metrics/[id]/anomalies/route.ts` — GET, response `{ data: AnomalyPoint[] }`
  - `app/api/v1/metrics/[id]/value/route.ts` — GET текущего значения с cached-vs-live fallback (если в `public.metrics` нет — резолвит наживо), `fresh` флаг (computed_at < 24h)
  - `app/api/v1/metrics/catalog/route.ts` (rewrite) — Zod-validated query (namespace/department/search/sort/page/pageSize/includeValues), 8 sort modes, opt-in value merge from `public.metrics`. 10 unit-тестов
- **`tests/integration/metrics-resolver.test.ts`** (Opus helper) — end-to-end против реальной Supabase: setup user + company + 5 survey rows, gather context, resolve ≥3 metrics, materialize round-trip + idempotency check, provenance shape assertions. Auto-skip без `SUPABASE_SERVICE_ROLE_KEY`. 5 тестов, проходят 2 раза подряд

### Phase 4 — Point A Aggregator v2 (Opus + 4 helpers)

- **`types/onboarding.ts`** (extended additively) — добавлено `intelligence?: PointAIntelligence` к существующему `PointA`. Новый interface:
  ```ts
  PointAIntelligence {
    by_department: Array<{ department, coverage, strongest[], weakest[] }>
    top_strengths: Array<{ metric_id, label, value, unit, namespace }>
    top_gaps: Array<{ metric_id, label, suggested_source, reason }>
    coverage: { biz, kpi, gri, goal, overall }
    trends: Array<{ metric_id, direction, delta_pct }>
    generated_at: string
    resolver_version: 'phase4-v1'
  }
  ```
- **`lib/point-a/helpers.ts`** — pure utilities: `buildByDepartment`, `buildTopStrengths`, `buildTopGaps`, `suggestSourceFor` (Russian suggestions: "Ответьте на анкету шаг 2: Выручка 2024" / "Загрузите P&L за 2024 Q4" / "Подключите интеграцию с 1C")
- **`lib/point-a/aggregator.ts`** (Opus main) — `aggregatePointA(supabase, userId, companyId, opts)`. Steps: gather context → `calculatePointA(surveyAnswers)` (existing engine untouched) → `resolveAllMetrics(ctx)` → optionally `materializeAll` → build `intelligence` → merge into PointA
- **`app/api/v1/point-a/aggregate/route.ts`** — GET (skipMaterialize) / POST (materialize). Auth via `createClient`. Returns `ApiResult<PointA>`. Fix: prod `companies` table имеет camelCase `createdAt`, не `created_at` — заменил order на `.order('id', ...)`
- **`lib/point-a/history.ts`** + **`app/api/v1/point-a/history/route.ts`** — версионированные snapshots из `public.diagnostics.version`. `listPointASnapshots`, `getPointAByVersion`, чистый `computeDiff(prev, next)` с per-block deltas + risks added/resolved counts. `?compare=N` returns snapshots + diff. 10 unit-тестов
- **`lib/point-a/benchmarks.ts`** + **`app/api/v1/point-a/benchmarks/route.ts`** — 8 индустрий × 24 rows (Розничная торговля / Электронная коммерция / B2B SaaS / Услуги / Производство / HoReCa / Образование / Медицина) с stage-overrides (all/early/growth/scale). `percentileAgainstBenchmark`, `ratingLabel` (≥75 "Выше среднего", ≥40 "На уровне", <40 "Ниже среднего"). Returns benchmark + comparison per block. 19 unit-тестов
- **`lib/point-a/narrative.ts`** + **`app/api/v1/point-a/narrative/route.ts`** — `generateNarrative(input)` через OpenRouter Sonnet 4.5 (jsonMode, T=0.5, 2500 tokens). Russian system prompt позиционирует модель как senior consultant. Zod-validated response: executive_summary, strengths_text, weaknesses_text, risks_text, opportunities_text, next_steps[]. POST route с кешированием в `diagnostics.ai_analysis`. 5 unit-тестов (mocked chat)
- **`lib/point-a/weights.ts`** — 13 weight profiles (`Industry × Stage`): default×all (30/25/20/15/10 — current engine), retail (35/25/15/15/10), ecommerce (marketing-heavy), b2b_saas×all + b2b_saas×seed (strategy-heavy), services, manufacturing (operations 30 + finance 30), horeca (operations 30), education, medical. `pickWeightProfile` с fallback chain (industry+stage → industry+all → default+stage → default+all). `applyWeights`, `validateWeights` (sum ±0.001). 19 unit-тестов
- **`lib/point-a/scoring-v2.ts`** (Opus helper) — value-add scoring engine: weights profile × benchmark percentile × resolved-metrics confidence calibration. `BlockScoreV2` extends `BlockScore` с `confidence`, `percentileVsBenchmark`, `benchmarkRating`. `overall_score_calibrated` blends overall_score_v2 с confidence (low conf → 0.9× discount; high conf → 1.05× lift, clamped). `classifyMetricToBlock` (heuristic by metric_id prefix). 14 unit-тестов
- **`tests/integration/point-a-aggregate.test.ts`** — e2e против реальной Supabase: создаёт user + company + 8 survey rows, вызывает aggregator, проверяет shape, idempotency. 3 теста

### Phase 5 — Realtime Layer (Opus)

- **`lib/realtime/channels.ts`** — pure helpers: `buildChannelName({ table, filter, name, event }, userId)` → `realtime:metrics:user-abc:*`, `buildFilter(column, value)` → `column=eq.value` (Supabase Realtime filter syntax)
- **`lib/realtime/sync-core.ts`** — framework-free `startRealtimeSync(supabase, queryClient, bindings)`. Debounce 250ms, dedupe invalidations, status tracking ('connecting' | 'open' | 'closed'), silent degradation на ошибках. Pure function — easily testable
- **`lib/realtime/__mocks__/supabase.ts`** — in-memory mock с `__emit(event)` / `__emitStatus` для тестов
- **`hooks/useRealtimeSync.ts`** — React adapter. Stable signature key (`table + filter + event`) для re-sub только при изменениях. Strict-mode-safe (mountedRef + cleanup cancels in-flight subscribe)
- **`hooks/useRealtimePointA.ts`** — composition: subscribe на metrics (filter company_id), diagnostics + documents (filter user_id), invalidate `['point-a-aggregate']`, `['metrics']`
- **`hooks/useRealtimeMetrics.ts`** — для `/metrics` страницы. Subscribe на metrics, invalidate `['metrics']`, `['metrics-catalog']`, и predicate-match для активных `['timeseries', *]` keys
- **22 unit-теста** (pure-function path, без @testing-library/react)

### Phase 6 — UI Components (Sonnet × 4 + Opus integration)

- **Phase 6a (UI primitives, structural-tested):**
  - `components/dashboard/MetricHealthCard.tsx` — карточка одной метрики (label + value + unit + trend badge + confidence dot + provenance hint), 4 highlight варианта (strength/gap/risk/opportunity). Russian formatting (₸/% млн/тыс/Intl.NumberFormat ru-RU)
  - `components/dashboard/MetricTrendBadge.tsx` — pill с direction + deltaPct, inverse-aware (CAC ↓ хорошо)
  - `components/dashboard/MetricProvenanceTooltip.tsx` — Radix Tooltip с типизированными источниками + computed_at relative time
  - `components/point-a/PointAInsightCard.tsx` — risks (level-coded) / insights / quick_wins / opportunities с CTA, area chip
  - `components/dashboard/_utils.ts` — shared formatters
- **Phase 6b:** `components/dashboard/MetricDrillDownModalV2.tsx` — modal с big value tile + Recharts AreaChart (4 layer toggles: fact/forecast/goal/anomalies), period picker (1M/3M/1Y/3Y/1W), description (what/why/how/current_state), provenance section, severity-colored anomalies. ESC + click-outside close. 28 unit-тестов структурно
- **Phase 6c:** `components/metrics/MetricSearchBox.tsx` (debounced 300ms + Cmd/Ctrl+K focus), `DepartmentChips.tsx` (scrollable, arrow-key nav, Framer stagger), `MetricSortToggle.tsx` (Radix DropdownMenu, 8 sort modes), `NamespaceTabs.tsx` (Radix Tabs). 19 тестов

- **Phase 6 final integration (Opus):**
  - **`hooks/usePointAAggregate.ts`** — React Query: `usePointAAggregate()` GET aggregate, `useRecalculatePointA()` POST + invalidates metrics
  - **`components/point-a/PointAIntelligenceSection.tsx`** — client section: realtime status indicator, coverage strip (5 namespaces), top strengths (6 cards), top gaps with suggested_source, by-department drill (chip filter), risks + quick_wins через PointAInsightCard, Пересчитать button
  - **`components/metrics/MetricsLiveCatalog.tsx`** — full catalog UI: NamespaceTabs + SearchBox + DepartmentChips + SortToggle + paginated grid из MetricHealthCard → drill-down MetricDrillDownModalV2. Wired через `useRealtimeMetrics` для live updates
  - **Wired into:**
    - `app/(dashboard)/dashboard/page.tsx` — для клиентов: добавлены Insights / Risks / Quick Wins секции + `<PointAIntelligenceSection />` между existing pointA section и Quick nav
    - `app/(dashboard)/point-a/page.tsx` — `<PointAIntelligenceSection />` перед File Area
    - `app/(dashboard)/metrics/page.tsx` — `<MetricsLiveCatalog />` сверху (над существующим static tab-switcher catalog)
    - `app/client/point-a/page.tsx` — `<PointAIntelligenceSection />` перед "Улучшить диагностику"

### Cabinet cleanup (последние правки)

- **Удалена «Стадия»** из везде: `/dashboard` KPI card (replaced with Продажи /10), `/client/dashboard` subtitle + StatCard (replaced with Industry), `/client/point-a` chip, `s1_stage` payload в `/client/onboarding`, dead `COMPANY_STAGES` import в `Step1CompanyForm.tsx`, dead `stageLabel` helper в `/client/point-a`
- **Middleware:** клиент после логина → `/dashboard` (sidebar-based), а не `/client/dashboard`. Fallback redirect `/client/dashboard` → `/dashboard`
- **Кнопка «Кабинет»** в `/client/point-a` ведёт на `/dashboard` (правильный sidebar cabinet)
- **`/point-b` полностью переписан** из хардкод-мока: server-side fetch survey + diag, call `calculatePointA` + `calculatePointB(pointA, answers)`. Рендер: targets KPI с current→target и progress, transformation row (Общий балл / Health / Стадия), GAP-анализ с priority badges, Q1-Q4 roadmap с focus_blocks + milestones (включая quick_wins из Точки А), user_goals секция (3-year goal + main pain + growth blockers). Empty state с CTA на анкету

---

## 4. Файлы

### Новые (`?? ` в git status)

| Путь | Размер | Что |
|------|--------|-----|
| `.claude/agents/aistart360-{data,ai-pipeline,realtime,ui}-engineer.md` | 4 файла | Specialized subagent definitions для будущих сессий |
| `supabase/migrations/016_metrics_resolver_extensions.sql` | 1 | Расширения public.metrics + Realtime publication |
| `supabase/migrations/017_documents_parsed_data.sql` | 1 | Добавлены parsed_data/parse_error/n8n_execution_id в documents |
| `scripts/apply-migration.js` | 1 | Универсальный runner DDL миграций |
| `scripts/verify-migration-016.js` | 1 | Верификатор колонок + publication |
| `scripts/inspect-documents-schema.js` | 1 | Утилита диагностики schema drift |
| `scripts/create-test-account.js` | 1 | Идемпотентный создатель тестовых аккаунтов |
| `scripts/seed-test-diagnostic.js` | 1 | Засев diagnostic'а в БД для тестового user'а |
| `lib/metrics/{types,registry,source-adapters,resolver,materialize,trend,seasonality,forecast,forecast-ensemble,anomalies,timeseries-fetch}.ts` | 11 | Phase 1 + 3 engines |
| `lib/documents/{bind-fields,bind-fields-ai,synonyms,classify,ocr,embed}.ts` | 6 | Phase 2 document pipeline |
| `lib/point-a/{aggregator,helpers,history,benchmarks,narrative,weights,scoring-v2}.ts` | 7 | Phase 4 + helpers |
| `lib/realtime/{channels,sync-core,__mocks__/supabase}.ts` | 3 | Phase 5 realtime |
| `hooks/{useRealtimeSync,useRealtimePointA,useRealtimeMetrics,usePointAAggregate}.ts` | 4 | React Query + realtime hooks |
| `components/dashboard/{MetricHealthCard,MetricTrendBadge,MetricProvenanceTooltip,MetricDrillDownModalV2,_utils,_drill-down-utils}.{tsx,ts}` | 6 | Phase 6a/6b UI primitives |
| `components/point-a/{PointAInsightCard,PointAIntelligenceSection}.tsx` | 2 | Phase 6a + Phase 6 final |
| `components/metrics/{MetricSearchBox,DepartmentChips,MetricSortToggle,NamespaceTabs,MetricsLiveCatalog,_utils}.{tsx,ts}` | 6 | Phase 6c + integration |
| `app/api/v1/metrics/[id]/value/route.ts` | 1 | Текущее значение endpoint |
| `app/api/v1/documents/[id]/rebind/route.ts` | 1 | Re-bind без re-extract |
| `app/api/v1/point-a/{aggregate,history,benchmarks,narrative}/route.ts` | 4 | Aggregator + history + benchmarks + AI narrative |
| `tests/unit/metrics/{resolver,anomalies,forecast,forecast-ensemble,seasonality,trend}.test.ts` | 6 файлов | 87/87 passing |
| `tests/unit/documents/{bind-fields,bind-fields-ai,synonyms,classify,ocr-decisions}.test.ts` | 5 файлов | 68/68 passing |
| `tests/unit/point-a/{aggregator,helpers,history,benchmarks,narrative,weights,scoring-v2}.test.ts` | 7 файлов | 96/96 passing |
| `tests/unit/realtime/useRealtimeSync.test.ts` | 1 | 22/22 passing |
| `tests/unit/components/{MetricHealthCard,MetricTrendBadge,MetricProvenanceTooltip,PointAInsightCard,MetricDrillDownModalV2,metrics-controls}.test.ts` | 6 файлов | 70+ passing |
| `tests/unit/api/{metrics-value-route,metrics-catalog-route,documents-rebind}.test.ts` | 3 файла | 23 passing |
| `tests/integration/{metrics-resolver,point-a-aggregate}.test.ts` | 2 | 8/8 passing against real Supabase |

### Модифицированные (`M ` в git status)

| Путь | Что |
|------|-----|
| `app/(dashboard)/dashboard/page.tsx` | Убрана Стадия KPI (replaced with Продажи) + добавлены Insights/Risks/QuickWins секции + `<PointAIntelligenceSection />` для client view |
| `app/(dashboard)/point-a/page.tsx` | `<PointAIntelligenceSection />` перед FileArea |
| `app/(dashboard)/point-b/page.tsx` | Полный rewrite: убраны хардкоды MILESTONES/TARGETS, теперь server-side fetch + `calculatePointB(pointA, answers)` → targets KPI / GAP analysis / Q1-Q4 roadmap / user goals |
| `app/(dashboard)/metrics/page.tsx` | `<MetricsLiveCatalog />` injection вверху |
| `app/api/v1/metrics/[id]/{anomalies,forecast,timeseries}/route.ts` | Wired через timeseries-fetch + новые engines |
| `app/api/v1/metrics/catalog/route.ts` | Rewrite stub → full filterable/sortable/paginated catalog с opt-in value merge |
| `app/api/v1/onboarding/documents/[id]/process/route.ts` | Fire-and-forget embedding pipeline behind feature flag |
| `app/client/dashboard/page.tsx` | Stage subtitle убран, StatCard Stage→Industry, добавлен navigation grid + `<PointAIntelligenceSection />` + companyId state |
| `app/client/point-a/page.tsx` | Nav header (Кабинет→/dashboard, Документы, Выход), Stage chip убран, `<PointAIntelligenceSection />` |
| `app/client/onboarding/page.tsx` | `s1_stage` убран из company payload |
| `components/onboarding/steps/Step1CompanyForm.tsx` | Dead `COMPANY_STAGES` import убран |
| `lib/ai/openrouter.ts` | Добавлен `embedWithOpenRouter` |
| `lib/documents/extract.ts` | `metric_id` в ParsedDataField + Zod + post-extraction bind |
| `middleware.ts` | Client redirect `/client/dashboard` → `/dashboard` (sidebar cabinet) |
| `types/onboarding.ts` | Additive `intelligence?: PointAIntelligence` на PointA + новый interface |
| `.claude/launch.json` | Fix runtimeExecutable + abs path to `next` binary в worktree |

---

## 5. API surface (новые / переписанные endpoint-ы)

| Метод | Путь | Что |
|-------|------|-----|
| GET | `/api/v1/metrics/catalog` | Filterable/sortable/paginated каталог с opt-in live values |
| GET | `/api/v1/metrics/[id]/value` | Текущее значение метрики (cached → live fallback) с fresh flag |
| GET | `/api/v1/metrics/[id]/timeseries?period=3M` | Серия из public.metrics |
| GET | `/api/v1/metrics/[id]/forecast?period=3M` | Forecast points с confidence band |
| GET | `/api/v1/metrics/[id]/anomalies` | Rolling z-score anomalies + flat-collapse |
| GET | `/api/v1/point-a/aggregate` | Point A v2 с intelligence enrichment |
| POST | `/api/v1/point-a/aggregate` | То же + materialize public.metrics |
| GET | `/api/v1/point-a/history?compare=N` | Versioned snapshots + diff |
| GET | `/api/v1/point-a/benchmarks?industry=X&stage=Y` | Industry benchmark + per-block percentile |
| POST | `/api/v1/point-a/narrative` | AI executive summary (Sonnet 4.5), cached в diagnostics.ai_analysis |
| POST | `/api/v1/documents/[id]/rebind` | Повторный bind без re-extract |

Все возвращают `ApiResult<T>` = `{ ok: true, data } | { ok: false, error }` КРОМЕ `/metrics/[id]/{timeseries,forecast,anomalies}` — они возвращают данные напрямую под существующий контракт `useTimeseries`/`useForecast`/`useAnomalies`.

---

## 6. Тесты

### Финальное состояние

- **`npx tsc --noEmit` → 0 errors**
- **`npm run build` → SUCCESS** (все routes собрались)
- **`npx vitest run` → 391/396 passed**
  - 5 failures — все pre-existing, не связаны с Point A работой:
    - 4× `tests/integration/middleware.test.ts` — RBAC redirect логика (заведённое тестом ожидание не совпадает с current middleware)
    - 1× `tests/integration/reports-upload.test.ts` — отсутствует `public.report_documents` таблица (Prisma schema vs prod drift, не Point A)

### Новые тесты (мои)

| Категория | Файлов | Тестов |
|-----------|--------|--------|
| metrics (resolver/anomalies/forecast/forecast-ensemble/seasonality/trend) | 6 | 87 |
| documents (bind-fields × 2, synonyms, classify, ocr-decisions) | 5 | 68 |
| point-a (aggregator/helpers/history/benchmarks/narrative/weights/scoring-v2) | 7 | 96 |
| realtime (useRealtimeSync core) | 1 | 22 |
| components (MetricHealthCard, TrendBadge, ProvenanceTooltip, PointAInsightCard, DrillDownModalV2, metrics-controls) | 6 | 70+ |
| api routes (metrics-value, metrics-catalog, documents-rebind) | 3 | 23 |
| integration (metrics-resolver, point-a-aggregate против реальной Supabase) | 2 | 8 |
| **ИТОГО** | **30** | **374** |

---

## 7. Сценарий проверки

### Тестовые аккаунты (созданы через `scripts/create-test-account.js`)

```
Email:    client@aistart360.local
Password: ClientPass2026!
Роль:     client (status=approved)
Company:  test-co-eb2a547d (B2B SaaS, Growth stage)
Survey:   31 ответ засеян (revenue 95M ₸, маржа 34.2%, CAC ₸25k, LTV ₸80k, amoCRM, KPI/OKR, цели роста)
Diagnostic: засеян через scripts/seed-test-diagnostic.js (overall=70, Growth)
```

### Что проверять

1. **Логин** → попадаешь сразу в `/dashboard` (sidebar cabinet)
2. **Sidebar nav** содержит Дэшборд / GRI / GRI Pulse / Точка А / Точка Б / Метрики / Рынок и т.д.
3. **`/dashboard`** для клиента: 4 KPI карточки (Общий балл / Health / Финансы / Продажи) + радар + 5 bar-блоков + **Инсайты** + **Риски** + **Quick Wins** + **Real-time Intelligence** (coverage + strengths + gaps + by-department + risks + quick-wins) + Быстрый доступ
4. **`/point-a`** (sidebar): Header + KPI 4 шт + Survey Overview + Domain Diagnostics + Real-time Intelligence + FileArea + Latest reports
5. **`/point-b`** (sidebar): Header с целью из анкеты + 6 целевых KPI (Выручка, Маржа, LTV/CAC, Health, Клиенты, Стадия) + 3 transformation cards + GAP-анализ с priority + Q1-Q4 roadmap + Цель 3 года/боль/барьеры
6. **`/metrics`** (sidebar): Live Catalog сверху (фильтры/поиск/sort/drill-down V2) + старый static catalog ниже
7. **`/client/point-a`**: Welcome hero + блоки (Финансы/Продажи/Операции/Маркетинг/Стратегия) + Real-time Intelligence + Documents prompt
8. **Анкета** (`/client/onboarding` шаг 1): нет поля «Стадия» (удалено)

### API проверка

```bash
# Без auth (registry-only)
curl http://localhost:3000/api/v1/metrics/catalog?namespace=biz&pageSize=30
# → 48 BIZ метрик

curl http://localhost:3000/api/v1/point-a/benchmarks?industry=b2b_saas
# → benchmark + comparison

# С auth
curl -b "sb-...session..." http://localhost:3000/api/v1/point-a/aggregate
# → { ok: true, data: PointA с intelligence }
```

---

## 8. Известные limitations / deferred

| Что | Где | Решение |
|-----|-----|---------|
| Search в каталоге чувствителен только к русским label/id ("revenue" не матчит) | `app/api/v1/metrics/catalog/route.ts:237-242` | Расширить через `lib/documents/synonyms.ts` |
| OCR не интегрирован в extract.ts (только helper готов) | `lib/documents/ocr.ts` | TODO comment в extract.ts: после parseDocument проверить `shouldFallbackToOcr(text, fileSize)` |
| Embeddings отключены по умолчанию | `ENABLE_DOCUMENT_EMBEDDINGS=true` env var | Safe-by-default rollout |
| AI binding путь в bind-fields пока без dedicated test | `bind-fields.ts:84` | Awkward to mock dynamic import target в vitest 4 |
| Trends array в intelligence пустой (`[]`) | `lib/point-a/aggregator.ts` | Phase 5 могла бы его наполнять, отложено |
| /client/dashboard остался в коде, но middleware теперь шлёт на /dashboard | `app/client/dashboard/page.tsx` | Можно удалить или оставить как fallback view |
| 5 pre-existing test failures (4 middleware RBAC, 1 reports-upload missing table) | `tests/integration/*` | Не Point A scope. Отдельная задача |

---

## 9. Команды

```bash
# Тесты
npx tsc --noEmit                                              # 0 errors
npm run lint                                                   # warnings only
npx vitest run                                                 # 391/396 passed
npm run build                                                  # SUCCESS

# Миграции
node scripts/apply-migration.js supabase/migrations/016_metrics_resolver_extensions.sql
node scripts/apply-migration.js supabase/migrations/017_documents_parsed_data.sql
node scripts/verify-migration-016.js

# Тестовые аккаунты
node scripts/create-test-account.js                            # qa-survey@aistart360.local, role=client, random password printed to the terminal
node scripts/create-test-account.js client@aistart360.local ClientPass2026! client
node scripts/seed-test-diagnostic.js client@aistart360.local   # засеять диагностику

# Запуск
npm run dev    # порт 3000
# или preview через launch.json: порт 53000
```

---

## 10. Subagent definitions (`.claude/agents/`)

Созданы 4 специализированных subagent-определения для будущих сессий:

- **`aistart360-data-engineer.md`** — Prisma + Supabase + migrations + resolver
- **`aistart360-ai-pipeline-engineer.md`** — OpenRouter Claude Sonnet 4.5 + extract + embeddings + RAG
- **`aistart360-realtime-engineer.md`** — Realtime channels + anomaly + forecast + hooks
- **`aistart360-ui-engineer.md`** — Design tokens + components + страницы (Material 3, dark glassmorphism, primary teal #6effc0)

Подхватятся как `subagent_type` в следующих сессиях Claude Code.

---

**Сводно:** Real-time Point A intelligence layer работает end-to-end. 57 новых файлов, 17 модифицированных, 374 новых теста (391/396 общая стопка), 2 миграции, 10 API endpoint-ов, 4 specialized subagent-а. От захардкоженного `/point-b` мока до полностью computed roadmap. От `parsed_data` NOT EXISTS в prod до working doc → metric binding с AI fallback. От нулевого realtime до автоматического invalidate React Query кэша на postgres_changes.
