# Technical Audit — AIStart360

Date: 2026-06-11. Method: 7 parallel evidence‑based audits (auth, questionnaire, Point A, GRI, dashboard/metrics, mock‑data sweep, backend/DB) cross‑checked against the codebase. Build (`next build`) exits 0; `tsc --noEmit` is clean. Severity: Critical / High / Medium / Low. Status: ☐ open · ◐ in progress · ☑ fixed.

> **Audit correction:** an earlier pass flagged `app/api/v1/point-a/narrative/route.ts`, `app/api/v1/point-a/insights/ai-generate/route.ts`, and `lib/insights/ai-generator.ts` as "missing P0 blockers". **All three exist** and `generatePointAInsights` is exported. Those findings are withdrawn.

## A. Data‑integrity / mock data (the core mandate)

| ID | Sev | File:line | Finding | Fix | Status |
|---|---|---|---|---|---|
| D1 | **Critical** | `lib/get-dashboard-data.ts` (deleted) | Returned hardcoded **Choco** KPI/alerts/signals/competitors for **every** user; rendered fabricated companies (Vortex Labs, Calyx Digital, Kaspi $5.6B) on `/insights`, `/intelligence`, `/competitors`. | **Fully removed**: deleted `lib/choco-data*`, `components/choco/*`, `chocofamily.json`, `get-dashboard-data.ts`, the `ChocoFamily Data` assets; pages are now honest empty states; `clients/[id]` Choco view + AdminClientsList pin + market/generate-insights fallback also cleaned. | ☑ done |
| D2 | **Critical** | `lib/functions/calculate-gri.ts:26-35` | GRI domain scores generated with `Math.random()` (`600 + random*400`). Reachable via `app/api/inngest/route.ts` → persisted to `griReport`. | Compute from real answers or refuse to persist; this path should not invent scores. | ☑ guarded |
| D3 | High | `app/api/v1/metrics/route.ts:95-97,197` | Returns `MOCK_METRICS` (₸84.2М etc.) when `financial_snapshots` is empty **and** on error (status 200). Empty is the normal state for new users. | Return `{source:'empty',data:[]}` / error status; never fabricate. | ☑ |
| D4 | High | `app/api/v1/metrics/[id]/goals/route.ts:7-22` | Always returns `MOCK_GOALS`; no DB lookup. | Query real goals; return null + empty state when absent. | ☑ |
| D5 | High | `app/api/market/osint/route.ts:53-105` | `buildMockNews/Competitors/Intelligence` fabricate market intel (NovaByte KZ ₸4.6B, tender wins). Rendered on `/market`. | Wire real OSINT or show "Источник не подключён" empty state. | ☑ empty-state |
| D6 | Med‑High | `app/(dashboard)/point-a/insights/page.tsx:38-148`; `components/point-a/v2/InsightsFeed.tsx:33-96` | `FULL_MOCK_ITEMS` / `MOCK_ITEMS` rendered as fallback when API empty/fails — fake AI/expert Q&A. | Render loading/empty/retry; never show mock as content. | ☑ |
| D7 | Med | `app/(owner)/owner/dashboard/page.tsx:6-26`; `app/(owner)/owner/gri/page.tsx:5-93`; `app/(expert)/expert/gri/page.tsx` | Hardcoded GRI blocks/scores/TOP‑5/Action Plan (e.g. `griScore = 4.59`, scores 7.4/6.7/…). | Fetch `/api/v1/gri/assessment`; compute TOP‑5 + plan; empty state when none. | ☐ |
| D8 | Med | `app/(dashboard)/insights/page.tsx:24-29` | `INSIGHT_CARDS` static fabricated insights. | Real insight source or remove/empty state. | ☑ |
| D9 | Low | `app/api/pulse/route.ts:196-197` | `Math.random()*10-5` variance injected into risk score over real CRM data. | Make deterministic or document as confidence band. | ☐ |
| D10 | Low | `lib/mock-data.ts` | `MOCK_*` fixtures; some unused (`MOCK_KPI`), some still imported by choco‑ext. | Delete dead exports; isolate the rest behind demo. | ☐ |

Safe (test‑only, leave): `prisma/seed.ts`, `scripts/seed-*.js`, `scripts/demo-sau-zhurek.ts`, `lib/realtime/__mocks__/supabase.ts`, `tests/**`, `lib/point-a/benchmarks.ts` (static reference catalog — label, don't delete).

## B. Authentication / authorization

| ID | Sev | File:line | Finding | Fix | Status |
|---|---|---|---|---|---|
| A1 | **Critical** | `app/api/v1/admin/pending-users/route.ts:7-21` | GET lists all pending users (email/phone/org) with **no auth**. | Require admin + permission. | ☐ |
| A2 | **Critical** | `app/api/giga-admin/auth/route.ts:8-22` | Super‑admin via plaintext env password, no rate‑limit, no audit; cookie `httpOnly:false`. | Hash secret, rate‑limit, `httpOnly:true`, audit. | ☐ |
| A3 | High | `app/api/auth/register/route.ts:9,39` | `role` accepted from client (`owner/admin/expert`); `email_confirm:true` skips verification. | Force `role:'client'` + `pending_approval`; verify email. | ☐ |
| A4 | High | `app/api/dev/register/route.ts`; `app/api/dev/confirm-email` | Dev backdoors gated only by `NODE_ENV!=='production'`. | Remove from prod build or IP‑gate. | ☐ |
| A5 | High | `app/api/v1/onboarding/documents/route.ts:8-21`; `…/onboarding/company`; `…/diagnostics/current`; `app/api/client/status` | Accept `user_id` from query, no ownership check → cross‑tenant read. | Derive user from session; verify ownership; rely on RLS. | ☐ |
| A6 | High | `app/giga-login/page.tsx:8-47` | Super‑admin password stored in `localStorage`. | Remove; use browser password manager only. | ☐ |
| A7 | Med | `middleware.ts:94-124` | Legacy `aistart360_role` cookie allowed through "for now" if Supabase session absent. | Remove fallback / expire. | ☐ |
| A8 | Med | `app/api/giga-admin/impersonate/route.ts` | Impersonation has no audit trail. | Log actor/target/time; notify user. | ☐ |
| A9 | Low | `middleware.ts:57-68` | All `/api/*` excluded from middleware auth; each route self‑guards (error‑prone). | Add a wrapper/lint to enforce auth on `/api/v1/*`. | ☐ |

## C. Questionnaire / onboarding

| ID | Sev | File:line | Finding | Fix | Status |
|---|---|---|---|---|---|
| Q1 | **Critical** | `lib/point-a-engine.ts:34-57` | Point A scores only `s2_revenue_*` (old step 2). New finance step writes `s9n_*`, so a user who fills the current form scores 0 on finance. | Read both key sets (fallback `s9n_*`); normalize. | ☐ |
| Q2 | High | `components/onboarding/steps/Step9FinanceForm.tsx:50` | `s9n_change_vs_2023` stored as string ("±15%") where numeric revenue expected. | Capture numeric revenue per year, or parse. | ☐ |
| Q3 | High | `lib/metrics/source-adapters.ts` | Survey→`metrics` ETL is stubbed ("Phase 1 stub"); resolver can't see survey for some keys. | Wire survey adapter to resolver context. | ☐ |
| Q4 | Med | `app/api/v1/onboarding/status/route.ts:38-49` | Reads goal keys `s6_goal_*` while step 2 writes `s2n_goal_*`; completion % counts distinct steps only, excludes step 0 (medical). | Reconcile keys; include vertical intakes. | ☐ |
| Q5 | Med | onboarding wizard | No centralized Zod schema; validation is field‑level; required fields not enforced before progression. | Add per‑step Zod schemas. | ☐ |
| Q6 | Med | `app/client/onboarding/page.tsx:218` vs status route | UI progress `(step-1)/12` disagrees with API `distinct_steps/12`. | Use one source. | ☐ |

## D. GRI

| ID | Sev | File:line | Finding | Fix | Status |
|---|---|---|---|---|---|
| G1 | High | `lib/gri-assessment/sections.ts` | Operations block has only **5** criteria (spec 6–11); duplicate `op-3` id (line ~368) silently overwrites a criterion. Total 65 vs spec 62. | Fix duplicate id; add Ops criteria. | ☐ |
| G2 | High | GRI POST `app/api/v1/gri/assessment/route.ts` | **TOP‑5 limitations not computed/persisted**; owner page shows static TOP‑5. | Implement `computeTop5` (5 lowest, tie‑break by block cost); store JSONB. | ☐ |
| G3 | High | — | **90‑day Action Plan not generated** (days 1–30 red / 31–60 yellow / 61–90 green). | Implement generator from TOP‑5 + zones. | ☐ |
| G4 | Med | `lib/gri/logic.ts`, `lib/functions/calculate-gri.ts` | Two unused/legacy GRI engines (one random — see D2). Real path is the assessment route (section averages, equal weights). | Remove dead engines; keep assessment route; add weighting if spec needs. | ◐ |
| G5 | Med | `app/api/pulse/route.ts` | "GRI Pulse" is actually a CRM pipeline monitor; no pulse survey table. | Product decision: build pulse survey or rename. | ☐ |

## E. Backend / DB / build

| ID | Sev | File:line | Finding | Fix | Status |
|---|---|---|---|---|---|
| B1 | High | `lib/auth.config.ts:15-16`, `lib/supabase-server.ts:16-17`, `app/api/auth/register/route.ts:16-17` | `process.env.X!` non‑null assertions on env vars missing from `.env.example` (`GOOGLE_CLIENT_ID/SECRET`, `ENABLE_DOCUMENT_EMBEDDINGS`, `GIGA_ADMIN_PASSWORD`). Crashes at runtime / prerender if unset. | Add to `.env.example`; validate at startup. | ◐ |
| B2 | High | `app/(auth)/forgot-password/page.tsx`, others | Pages build a Supabase client at module eval → prerender error when env absent. | `force-dynamic` or lazy client init. | ☐ |
| B3 | Med | `lib/rate-limit.ts` | `authRateLimit` configured but never `.limit()`‑ed on any route. | Apply to `/api/auth/*`, demo‑access. | ☐ |
| B4 | Med | `lib/supabase-server.ts` vs `lib/supabase/server.ts` (+ client dupes) | Two server clients (sync vs async `cookies()`), inconsistent imports. | Consolidate. | ☐ |
| B5 | Med | many `app/api/*` | Inconsistent response envelopes (`{data,meta}` vs `{ok}` vs raw); some leak error detail. | Standardize via `lib/api-utils.ts`. | ☐ |
| B6 | Med | Prisma vs Supabase | Overlapping entities (`profiles`/`User`, `companies`/`Client`, `documents`/`Report`) with no conflict guard; service‑role writes bypass RLS. | Document ownership; lint to prevent cross‑writes. | ☐ |
| B7 | Med | `lib/notifications.ts:228,363` | Telegram/email failures swallowed (`.catch(()=>{})`); sent inline (can block request). | Observability + queue. | ☐ |
| B8 | Low | tests | 12 integration tests; thin for app size; few API‑route tests. | Expand around fixed paths. | ☐ |

## F. Performance / frontend states

- Realtime sync (`lib/realtime/*`, `hooks/useRealtimeSync`) is correctly wired (migration 016, REPLICA IDENTITY FULL); minor staleTime/debounce mismatch (60s vs 250ms) can show stale Point A briefly — Low.
- Empty/loading states exist on main dashboard, GRI widget, AI carousel, metrics catalog. Gaps: insights/intelligence/competitors (fabricated instead of empty), Point A empty state doesn't say *what* to fill next, document parse failures are silent.
- Indexes present on hot paths (`survey_answers`, `documents`, `metrics`, `diagnostics`); queries use `Promise.all`. No obvious N+1.

## Severity rollup

- Critical: D1, D2, A1, A2, Q1
- High: D3, D4, D5, D6, A3, A4, A5, A6, Q2, Q3, G1, G2, G3, B1, B2
- Medium: D7, D8(↓Low after fix), A7, A8, Q4, Q5, Q6, G4, G5, B3–B7
- Low: D9, D10, A9, B8, realtime staleTime

Implementation order and acceptance criteria: see `implementation-plan.md`. Per‑widget lineage: see `metrics-data-lineage.md`.
