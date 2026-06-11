# Implementation Plan — AIStart360 Stabilization

Goal: a stable, production‑ready business‑diagnostics portal where **every displayed value is real or an explicit empty state**, working flows are preserved, and the documented Контур 1 pipeline holds together. Work in small, reviewable, verified steps on the current branch (`claude/trusting-swartz-241752`).

Status: ☐ open · ◐ in progress · ☑ done. IDs reference `technical-audit.md`.

## Phase 1 — Stabilization & test build
- ☑ Install deps, confirm `tsc --noEmit` clean, `next build` exits 0 (baseline captured).
- ☑ Produce audit + lineage + plan docs.
- ☐ **B2**: make env‑dependent pages render dynamically (no prerender crash without env). *Files:* `app/(auth)/forgot-password/page.tsx`, any page building a Supabase client at eval. *Accept:* build with empty env produces no prerender error.
- ◐ **B1**: complete `.env.example` (`GOOGLE_CLIENT_ID/SECRET`, `ENABLE_DOCUMENT_EMBEDDINGS`, `GIGA_ADMIN_PASSWORD`, Upstash, Telegram) + a startup env‑check helper. *Accept:* missing critical env throws a named error, not a `TypeError`.

## Phase 2 — Mock/fake data removal (the core mandate) — PRIORITY
- ☑ **D3** `/api/v1/metrics`: empty/error → `{source,data:[]}`, never MOCK_METRICS. *Accept:* new user sees empty tiles, not ₸84.2М.
- ☑ **D4** `/api/v1/metrics/[id]/goals`: real query or null; no MOCK_GOALS.
- ☑ **D1** Choco **fully removed** (data files, `components/choco/*`, `get-dashboard-data.ts`, raw assets, `clients/[id]` view, AdminClientsList pin, market fallback). `/insights` + `/intelligence` + `/competitors` are honest empty‑state pages. *Verified:* grep "choco" clean, build 95/95.
- ☑ **D8** `/insights` `INSIGHT_CARDS`: removed/empty‑stated.
- ☑ **D5** `/api/market/osint`: no `buildMock*`; empty/"источник не подключён".
- ☑ **D6** Point A insights page + `InsightsFeed`: loading/empty/retry instead of MOCK items.
- ☑ **D2** `lib/functions/calculate-gri.ts`: stop persisting `Math.random` scores (guard/throw).
- ☐ **D7** owner/expert GRI + owner dashboard: fetch real `gri_assessments`; empty state when none.
- ☐ **D9/D10**: remove `Math.random` variance in pulse; delete dead `MOCK_*`.

## Phase 3 — API & database consistency
- ☐ **A5**: derive `user_id` from session, verify ownership on onboarding/documents, onboarding/company, diagnostics/current, client/status. *Accept:* user B cannot read user A's docs/status.
- ☐ **B4**: consolidate Supabase server/client into one module; fix import drift.
- ☐ **B5**: one response envelope (`ok/data/error`) via `lib/api-utils.ts`; stop leaking error detail.
- ☐ **B6**: document Prisma vs Supabase table ownership; lint guard against cross‑writes.

## Phase 4 — Dashboard & metrics correctness
- ☐ Portfolio GRI org‑scoped (lineage: add `orgId` filter).
- ☐ **Q3**: wire survey→resolver adapter so survey answers feed `public.metrics`.
- ☐ Point A: populate `intelligence.trends` from prior `diagnostics` version; wire LTV/CAC/no‑show tiles or hide; finish inverse‑zone logic.

## Phase 5 — Diagnostic modules correctness
- ☐ **Q1/Q2**: Point A finance reads both `s2_revenue_*` and `s9n_*`; capture numeric per‑year revenue.
- ☐ **Q4/Q6**: reconcile goal keys (`s6_*` vs `s2n_*`); single completion‑% source.
- ☐ **G1**: fix duplicate `op-3`; bring Operations to ≥6 criteria.
- ☐ **G2**: compute + persist TOP‑5 (5 lowest, tie‑break by block cost).
- ☐ **G3**: generate 90‑day Action Plan (days 1‑30 red / 31‑60 yellow / 61‑90 green) from TOP‑5.
- ☐ **G4**: remove dead GRI engines; **G5**: product decision on Pulse.

## Phase 6 — Frontend loading/error/empty states
- ☐ Apply the Empty State Standard everywhere a value can be absent.
- ☐ Point A empty state names the next action ("Заполните блок Финансы").
- ☐ Surface document‑parse failures to the user.

## Phase 7 — Backend validation & security
- ☐ **A1**: auth on `pending-users`. **A3**: force client role + email verify. **A4**: remove dev backdoors in prod.
- ☐ **A2/A6**: hash giga password, rate‑limit, `httpOnly` cookie, drop localStorage password. **A8**: impersonation audit.
- ☐ **B3**: apply rate‑limit to auth + demo‑access. **A7**: remove legacy cookie fallback.

## Phase 8 — QA & regression
- ☐ Expand integration tests around every fixed path (empty‑state contracts, ownership checks, GRI TOP‑5).
- ☐ `npm test`, `npm run lint`, `npm run type-check`, `npm run build` all green.

## Phase 9 — Production‑readiness checklist
- ☐ No production‑visible mock data (grep sweep clean of `MOCK_`, `Math.random` in value paths).
- ☐ Auth on all sensitive endpoints; cross‑tenant isolation verified.
- ☐ Empty/loading/error on every page; no infinite spinners.
- ☐ Env documented + validated; secrets only in env, never committed.
- ☐ Build/test/lint green; key flows (register→survey→Point A→GRI→dashboard) manually verified.

## Empty State Standard (use consistently, Russian)
- Нет данных вовсе: **"Данных нет"**
- Недостаточно для расчёта: **"Недостаточно данных для расчёта"**
- Нужна анкета: **"Заполните анкету, чтобы увидеть результаты"**
- Нужна диагностика: **"Метрика появится после прохождения диагностики"**
- Источник не подключён: **"Источник данных не подключён"**

Every page must support loading, empty, error, and valid states.

## Notes on safety
- Preserve working flows (register/auth/survey/Point A/GRI/dashboard). Changes are additive empty‑states + removing fabricated values; no schema drops.
- Demo data (Choco, seed scripts) kept only behind explicit demo flags / manual scripts, never default production render.
