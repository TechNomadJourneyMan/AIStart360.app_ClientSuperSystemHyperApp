# Product Requirements Map — AIStart360 (Контур 1)

> Source of truth: the attached product docs (Концепт, AIStart_Contour_1_Detailed, AIStart_PointA_Functions, AIStart360_Metrics_Guide, GRI ACTION_PLAN). This file maps the documented product onto the current codebase. Last synced: 2026-06-11.

## 1. Product summary

AIStart360 is a **business‑diagnostics SaaS** ("платформа роста выручки"). It runs every company through a universal pipeline (**Контур 1**) that turns raw company data into a living growth dashboard:

```
Регистрация → Сбор данных (анкета + файлы) → Анализ рынка → Метрики (Точка А)
            → GRI‑диагностика → Карта роста (Точка B) → Дашборд
```

The promise is **Аналитика → Стратегия → Действие** as one conveyor: not a PDF strategy, but a dashboard that recomputes automatically as data changes, with AI insights at every step and an expert (AIStart360) validating. A second, vertical‑specific track (**Контур 2**, clinics / e‑commerce) executes the strategy operationally; only Контур 1 is in scope for stabilization here, though the repo already contains medical + e‑commerce verticals.

## 2. User roles

| Role | Source in code | Purpose |
|---|---|---|
| **client** (owner of a company) | `profiles.role = 'client'` | Fills survey, uploads files, sees own Point A / GRI / metrics / dashboard |
| **expert** (also `manager`, `analyst` normalized → expert) | `profiles.role`, `EXPERT_ROLES` | Validates AI output, leaves comments, views assigned clients |
| **admin / owner** | `profiles.role` | Platform ops, approvals, portfolio view |
| **super_admin** (ГИГА‑Панель) | cookie `aistart360_role`, `GIGA_ADMIN_PASSWORD` | Internal super‑admin console; review requests, impersonate |

Role enforcement is split between `middleware.ts` (route‑group gating via Supabase session + `profiles.role`) and per‑endpoint checks. See technical‑audit §Auth for gaps.

## 3. Main user journeys

1. **Register** (landing / `/register` / Google OAuth / demo button) → profile created (`pending_approval`).
2. **Onboarding survey** (`/client/onboarding`, 12 steps) + **file upload** → `survey_answers`, `documents`.
3. **Point A** recomputed from answers + parsed docs → `/client/point-a`.
4. **GRI diagnostic** (62‑criteria assessment) → `gri_assessments`, TOP‑5 limits.
5. **Point B** goals + gap → `/client/point-b`.
6. **Dashboard** consolidates everything → `/dashboard` (owner) / `/client/dashboard`.

## 4. Required modules (from docs) vs implementation

| # | Module (doc) | Required behavior | Implemented? | Notes |
|---|---|---|---|---|
| 01 | Регистрация / сбор данных | name, phone, site/sphere, revenue fact + 12m/3y plan; create company card | ✅ Partial | Multiple register endpoints; role accepted from client (security gap) |
| — | Анкета (7 блоков) | О компании, Финансы, Цели, Продукт, Оргструктура, Управление, База клиентов | ⚠️ Divergent | Implemented as **12 steps**, not 7 blocks; field keys drifted (`s2_*` vs `s9n_*`) |
| 02 | Анализ рынка | 6 blocks / 50 params, TAM/SAM/SOM, CAGR, competitors, ×10 microsegment, from open sources | ⚠️ Mostly mock | `/api/market/osint` returns canned news/competitors; market cards are templates |
| 03 | GRI | 7 blocks × 6–11 criteria = 62, score 1–10, zones, auto TOP‑5, feeds Action Plan | ⚠️ Partial | Assessment + scoring exist (65 criteria); **TOP‑5 and 90‑day plan not computed**; owner/expert GRI pages hardcoded |
| 04 | Метрики · Точка А | 6 metric blocks, 9‑column table, % plan, color zones, retention widget | ⚠️ Partial | Resolver‑based catalog is real; legacy `/api/v1/metrics` returns mock when empty; LTV/CAC/no‑show tiles are TODO |
| 05 | Карта роста · Точка B | goals, gap, required growth rate, 90‑day plan, 6 levers | ⚠️ Partial | Point B engine exists; Action Plan not generated from GRI TOP‑5 |
| 06 | Дашборд | path‑to‑goal, KPI row, GRI widget, metrics table, TOP‑5 tasks, dynamics chart, AI feed | ⚠️ Partial | Owner dashboard + insights/intelligence/competitors pages show hardcoded **Choco** demo data to all users |

## 5. Required backend entities (from docs) → tables

- Company card → `companies`, `profiles`
- Survey → `survey_answers` (step 0–12, `question_key`, `answer` JSONB)
- Files → `documents` (`parsed_data` JSONB), `DocumentChunk` (vector 1536, mostly unpopulated)
- Point A snapshot → `diagnostics` (versioned, `is_current`)
- Metrics → `public.metrics` (materialized by resolver), legacy `financial_snapshots`
- GRI → `gri_assessments` (versioned), legacy Prisma `GriReport`
- Insights / questions → `point_a_insights`
- Market / losses / segments → `revenue_losses`, `patient_segments`, `growth_bundles`

Prisma and Supabase share one Postgres but own **different** tables. `public.metrics` is the materialization target.

## 6. Required integrations

- **OpenRouter** (`anthropic/claude-sonnet-4.5`) for document extraction, Point A narrative, insights, GRI strategy. Native Anthropic SDK present but parsing goes via OpenRouter.
- **Supabase** (auth, storage, realtime, Postgres + RLS).
- **Resend** (email), **Telegram** (admin notifications).
- **Upstash Redis** (rate‑limit — configured, not applied).
- **Inngest** (background jobs — instantiated, GRI calc job uses random numbers).
- **CRM**: Bitrix24 / amoCRM adapters (feed Pulse).

## 7. Ambiguous requirements / assumptions made

1. **7 blocks vs 12 steps** — code uses 12 steps. Assumption: keep 12 steps (richer), but the completion % and downstream consumers must read a single consistent set of field keys. Documented as a fix, not a rewrite.
2. **GRI Pulse** — docs imply a lightweight recurring GRI health check; code's `/api/pulse` is a **CRM sales‑pipeline monitor**. Assumption: these are two different features; "Pulse" naming is overloaded. Flagged for product decision.
3. **Insights / Intelligence / Competitors pages** — not part of the documented Контур 1 core (which is Dashboard/Point A/Point B/GRI/Metrics/Market/Survey). They appear to be a portfolio "holding" view built around a Choco case study. Assumption: they are not core client deliverables; safest action is real data or an empty state, never fabricated companies.
4. **Currency** — docs mix ₸ (KZT) and rubles; UI standard is ₸ (`lib/format/kzt.ts`). Keep ₸.
5. **Benchmarks** — hardcoded in TS. Acceptable as a static reference catalog (not user data), but should be labeled as reference, not "your data".

## 8. Risks

- **Data integrity (highest):** production pages render fabricated company data (Choco) and mock metrics to real users — directly violates the no‑mock mandate.
- **Security:** several unauthenticated/ownership‑unscoped API endpoints; role accepted from client at registration; super‑admin password in env + non‑httpOnly cookie. See technical‑audit §Auth.
- **Correctness:** GRI scores via `Math.random` in one Inngest path; survey field‑key drift means revenue entered in the new finance step doesn't score Point A.
- **Consistency:** duplicate Supabase clients, inconsistent API envelopes, dual Prisma/Supabase ownership of overlapping entities.

## 9. Where the documented copy lives

Empty‑state and CTA copy is Russian and already partially present (e.g. "Анкета ещё не заполнена", "Инсайты появятся…"). Standardize on the Empty State Standard in `implementation-plan.md` §6.
