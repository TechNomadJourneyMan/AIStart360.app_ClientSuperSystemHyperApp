# Metrics Data Lineage Map — AIStart360

For every dashboard/metric UI element: where the value comes from, which endpoint, which table, the calculation, the empty‑state, the known issue, and fix status. Verdict legend: ✅ real · ⚠️ partial · ❌ mock/fabricated.

## Main dashboard (`/dashboard`, owner) & client dashboard

| UI element | Page/Route | Source endpoint | DB source | Calculation | Empty state | Issue | Verdict / Fix |
|---|---|---|---|---|---|---|---|
| KPI cards (users, active, pending, GRI count) | `/dashboard` | server component | `profiles`, `diagnostics` | counts/aggregates | "—" + загрузка | none | ✅ |
| Portfolio GRI radar (7 domains) | `/dashboard` | `getPortfolioGRI()` | `diagnostics.*_score` | avg across **all** orgs | "Нет диагностик в портфеле" | not org‑scoped → cross‑tenant aggregate | ⚠️ add orgId filter |
| Path‑to‑goal / progress bar | `GrowthSnapshotHero` | `/api/v1/metrics` | `financial_snapshots` | fact/plan×100 | "—" | mock when snapshots empty | ❌→ empty (D3 fixed) |
| Revenue/Margin/Clients/AvgCheck tiles | dashboard + Point A | `/api/v1/metrics` | `financial_snapshots` | trend=(cur−prev)/prev | "—" | **MOCK_METRICS fallback** | ❌→ empty (D3 fixed) |
| AI insights carousel | `/dashboard` (client) | `pointA.insights` | `diagnostics.insights` | risks+quick_wins | "Инсайты появятся…" | only after diagnostic | ✅ |
| GoalsBar (pinned goals) | `/dashboard` | Zustand store | session only | user‑pinned | empty pill bar | not persisted to DB | ⚠️ persist later |

## Insights / Intelligence / Competitors / Market (portfolio pages)

| UI element | Page | Source | DB source | Empty state | Issue | Verdict / Fix |
|---|---|---|---|---|---|---|
| Insight cards | `/insights` | `INSIGHT_CARDS` const | none | none | fabricated insights + fake clients | ❌→ empty (D1/D8 fixed) |
| Signal feed | `/insights` | `getDashboardData().SIGNALS` | none (Choco) | none | fabricated, shown to all users | ❌→ empty (D1 fixed) |
| Intelligence hub | `/intelligence` | `getDashboardData()` | none (Choco) | none | fabricated | ❌→ empty (D1 fixed) |
| Competitor matrix | `/competitors` | `getDashboardData().COMPETITORS` | none (Choco) | none | fabricated (Kaspi/Glovo) | ❌→ empty (D1 fixed) |
| Market news / competitors / intel | `/market` | `/api/market/osint` | none | none | `buildMock*` fabricated | ❌→ empty (D5 fixed) |

## Metrics page (`/metrics`) — resolver‑based (canonical)

| UI element | Endpoint | DB source | Calculation | Empty state | Issue | Verdict |
|---|---|---|---|---|---|---|
| Metric catalog (122 metrics) | `/api/v1/metrics/catalog` | `public.metrics` (materialized) | resolver priority: manual>document>survey>prisma>external | "—" / "Нет видимых метрик" | survey adapter stubbed (Q3) | ⚠️ real where sources exist |
| KPI tab (GRI score, targets) | `/api/v1/metrics` + catalog | `gri_assessments`, `companies.target_revenue_*` | latest `is_current` + targets | "нет данных" | — | ✅ |
| Biz tab (department metrics) | `/api/v1/metrics/catalog` | `public.metrics` | resolver | "—" | — | ✅ |
| Timeseries / Forecast / Anomalies | `/api/v1/metrics/[id]/{timeseries,forecast,anomalies}` | `public.metrics` history | linear reg + EMA; rolling z‑score | empty chart | needs ≥N points | ✅ |
| Metric goals | `/api/v1/metrics/[id]/goals` | (none) | — | — | **always MOCK_GOALS** | ❌→ real/null (D4 fixed) |

## Point A page (`/client/point-a`, `/point-a`)

| UI element | Endpoint | DB source | Calculation | Empty state | Issue | Verdict |
|---|---|---|---|---|---|---|
| Overall score, 5 domain blocks | `/api/v1/point-a/aggregate` | `survey_answers` | rule‑based engine | "Анкета ещё не заполнена" | finance scores only `s2_*` (Q1) | ⚠️ |
| Intelligence (coverage, gaps, strengths) | `/api/v1/point-a/aggregate` | `public.metrics` + docs | resolver | null → "not built" | doesn't say what to fill (UX) | ⚠️ |
| Trends (up/down/flat) | `/api/v1/point-a/aggregate` | `public.metrics` | — | empty | **array hardcoded empty** (Phase 5) | ⚠️ |
| 6 key metric tiles | `/api/v1/metrics/catalog` | `public.metrics` | zone by %plan | "—" | LTV/CAC/no‑show tiles are TODO placeholders | ⚠️ |
| 3 color zones | `/api/v1/metrics/catalog` | `public.metrics` | ≥80 green/50–79 yellow/<50 red, inverse for no‑show/churn/CAC | "Нет данных" | inverse logic not fully wired | ⚠️ |
| Retention curve (30/60/90/180/365) | `/api/v1/point-a/retention-curve` | `documents.parsed_data` | cohort from uploaded base | empty | needs client‑base file | ✅ |
| Top sales table | `/api/v1/point-a/top-table` | `survey_answers` | from s5 funnel + s2 clients | empty | — | ✅ |
| AI narrative | `/api/v1/point-a/narrative` | LLM (survey+diag) | OpenRouter Sonnet 4.5 | — | needs key; real | ✅ |
| AI insights (clarifying Qs) | `/api/v1/point-a/insights/ai-generate` + `/insights` | `point_a_insights` / LLM | `generatePointAInsights` | loading/empty | page renders MOCK fallback (D6) | ⚠️→ fixed |
| Benchmarks | `/api/v1/point-a/benchmarks` | hardcoded TS (8 industries) | static | — | static reference catalog | ⚠️ label as reference |

## GRI (`/gri`, owner/expert GRI)

| UI element | Endpoint | DB source | Calculation | Empty state | Issue | Verdict |
|---|---|---|---|---|---|---|
| Assessment (62/65 criteria, 1–10) | `/api/v1/gri/assessment` | `gri_assessments` | section avg, overall mean | resume/empty | Ops block 5 criteria + dup id (G1) | ⚠️ |
| GRI radar widget | dashboard | `/api/v1/gri/assessment` | section averages vs benchmark | empty | — | ✅ |
| TOP‑5 limitations | owner/expert GRI | (none) | should be 5 lowest, tie‑break by cost | — | **hardcoded** (G2) | ❌ |
| 90‑day Action Plan | owner GRI / Карта роста | (none) | days 1‑30/31‑60/61‑90 by zone | — | **hardcoded** (G3) | ❌ |
| GRI domain scores (Inngest path) | `app/api/inngest` | `griReport` | `Math.random()` | — | **random** (D2) | ❌→ guarded |
| GRI strategy / financial analyst | `/api/gri/ai-strategy`, `/api/gri/financial-analyst` | LLM / heuristic | OpenRouter or regex fallback | — | generic fallback | ⚠️ |

## Pulse (`/pulse`)

| UI element | Endpoint | DB source | Calculation | Issue | Verdict |
|---|---|---|---|---|---|
| Pipeline stats, today clients, AI briefing | `/api/pulse` | CRM (Bitrix24/amoCRM) + `companies`/`diagnostics` | risk/churn per deal | `Math.random` variance (D9); is a CRM monitor, not GRI pulse (G5) | ⚠️ |

## Source‑of‑truth notes

- `public.metrics` is the **materialization target**; the resolver (`lib/metrics/resolver.ts`) returns `null` (never random) when all sources miss — this is the correct, real path.
- The legacy `/api/v1/metrics` route reads `financial_snapshots` (not populated by the survey flow) — its mock fallback was the main offender for fabricated dashboard numbers.
- `diagnostics` (versioned, `is_current`) holds Point A snapshots; `gri_assessments` (versioned) holds GRI.
