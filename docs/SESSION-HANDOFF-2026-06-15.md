# Session Handoff — 2026‑06‑15 (autonomous night session)

Branch: `claude/priceless-jackson-372279` · base: `c7d1095` (last commit by TechNomadJourneyMan).
All work is committed **locally** (not pushed). Review per commit; `git reset --hard c7d1095` reverts everything.

## Commits made this session

| Commit | What |
|---|---|
| `b5a5cb6` | feat(point-b): goal‑driven Point B engine, API, UI — replace stub |
| `bcbacd4` | feat(point-b): capture current revenue (survey + inline input) + persist snapshot |
| `9513036` | fix(expert): replace hardcoded mock insights with honest state |

Verification across the session: `tsc --noEmit` clean · `next build` green · **23 Point B unit tests pass** · 507 unit tests pass (1 pre‑existing env failure: `RFMSegmentsGrid` JSX‑transform, unrelated) · Point B page verified rendering + hydrating in the browser.

---

## 1. Point B — fully rebuilt (was a stub) ✅

**Problem:** the old `lib/point-b-engine.ts` computed target = current × stage‑multiplier (seed ×2.5…), **ignored the owner's real numeric goal**, read only legacy survey keys, and never persisted (`point_b_analysis` had 0 rows; code never touched it).

**Now (goal‑driven):**
- `lib/point-b/engine.ts` → `calculatePointBV2()` — pure, **23 unit tests** (`tests/unit/point-b/engine.test.ts`). Reads the real numeric goals (`s1_goal_12m/3y_revenue_year/month`), current revenue (`s1_current_revenue_*` → `s2_revenue_*` → metrics override). Computes: gap (abs/%/multiplier/**required CAGR**/MoM/QoQ), monthly+quarterly trajectory, scenarios (cautious/base/aggressive), realism (level by CAGR + weak‑block penalty), data‑sufficiency, **5 horizons** (3y/1y/quarter/month/week), growth levers, TOP‑5 from GRI. **Never fabricates** — missing inputs → honest "Недостаточно данных".
- API `app/api/v1/diagnostics/point-b/route.ts` — auth from session (**closed the old `?user_id=` IDOR**), reads diagnostic + survey + GRI top‑5 + metrics revenue, computes, **persists** an `is_current` snapshot to `point_b_analysis` (full object in `roadmap`; scalars mirrored; non‑fatal — a write error never breaks the read).
- UI `components/point-b/*` (`PointBView` + `PointBContainer` + sub‑components) mounted on **all** client surfaces: `/client/point-b` (primary), `/point-b`, `/owner/point-b`. Covers loading/error/no‑diagnostic/insufficient/valid states.

**How to test:** log in as a client who has a current diagnostic + numeric goals; open `/client/point-b`. With current revenue present it renders the full plan; without it, the honest insufficient‑data panel with an inline "укажите текущую выручку" input.

---

## 2. Current‑revenue capture (your choice "1 и 2") ✅

The newer `s1_*` survey captured goals but **no current revenue**, and `public.metrics.revenue` rows are all `0` — so the gap couldn't compute for many users. Added both paths:
- **Survey (option 2):** `components/onboarding/steps/Step1CompanyForm.tsx` — new "Текущая выручка" card (month → year auto‑calc), keys `s1_current_revenue_month/_year`.
- **Page input (option 1):** inline input in the Point B insufficient panel → `POST /api/v1/diagnostics/point-b/current-revenue` upserts `s1_current_revenue_*` to `survey_answers` for the session user, then recomputes.

---

## 3. Module audit (5 read‑only auditors) — findings

> ⚠️ **One auditor hallucination caught & rejected:** the Metrics auditor flagged `lib/metrics/materialize.ts:148` (`if (v.picked === null || v.numeric === null) continue`) as "dropping zeros". It does **not** — `0 === null` is `false`, so zeros are materialized. **No change made.** Verify before trusting any single‑agent claim.

### Confirmed production mock — FIXED
- `app/(expert)/expert/insights/page.tsx` — was a hardcoded `INSIGHTS` array (fake "ARR +18.2%", "₸4.2 млрд", "churn 2.1%"). **Replaced with an honest state** (insights are per‑client; review inside each client). Commit `9513036`.

### Confirmed production mock — FLAGGED (needs your UX call, not edited)
- **`app/(dashboard)/admin/page.tsx`** — the **overview tab** renders fabricated data: stats grid `48 / 5.8 / 56 / 34` (lines 83‑87), `CONTENT_SECTIONS` counts ("34 отчёта", "56 аккаунтов"… line 9‑21/111), `RECENT_ACTIVITY` "Live Intel" with fake clients ("Vortex Labs GRI 8.4", "Astra Ventures Churn 12%"… lines 41‑46/121), `GRI_DISTRIBUTION` (lines 24‑29/168), and an "AI INSIGHT" macro card (lines 181‑186). Real parts (`SystemHealth`, `PendingClientsTable`, `AdminClientsList`) are fine. **Decision needed:** wire these to real aggregates vs honest placeholders vs remove the decorative sections. I left it intact to avoid a half‑migrated, inconsistent page. `app/(expert)/expert/dashboard/page.tsx` is already a real‑data version (no action).

### Other findings by module (severity · fix risk · recommendation)

**GRI** — real 62‑criteria assessment works (`/api/v1/gri/assessment`, TOP‑5 + 90‑day plan persisted via migration 026; GRI→Point B wired). **Dual engine remains:** legacy `app/actions/gri.ts` + `lib/gri/logic.ts` feed `/ai-scanner` via Prisma `griReport` — a conflicting second source. (HIGH · fix risk HIGH — touches `/ai-scanner` UX.) `lib/portfolio-gri.ts` derives a *synthetic* GRI from Point A blocks instead of reading `gri_assessments.gri_index` (HIGH · MED). No `Math.random` scores remain.

**AI insights** — Point A insights ARE AI‑generated with provenance via **OpenRouter** (`lib/insights/ai-generator.ts`); `point_a_insights` is empty only because generation is on‑demand. **Provider drift:** `lib/ai/point-a-analyzer.ts` + `lib/ai/point-b-analyzer.ts` use `@ai-sdk/anthropic` (needs `ANTHROPIC_API_KEY`) while everything else uses OpenRouter (`OPENROUTER_API_KEY`); model strings differ (`claude-sonnet-4-5` vs `anthropic/claude-sonnet-4.5`). With **no LLM key** (current env) all AI degrades honestly (null / static fallback) — no fabrication. (BLOCKER‑ish for AI features · MED · consolidate on OpenRouter + explicit "LLM not configured" 503.)

**Admin (API)** — canonical surface = `/admin-giga-panel` (super_admin, signed httpOnly giga cookie); live namespace = `/api/giga-admin/*`. `/api/admin/*` (Prisma+NextAuth) and `/api/v1/admin/*` (Supabase) are largely **dead duplicates** (3 namespaces). Giga approve/reject/block do **not** write `audit_logs` (table empty). (HIGH · audit‑logging fix is LOW risk but touches sensitive endpoints — recommend you approve before I edit. Namespace consolidation MED‑HIGH.)

**Expert** — experts currently see **all** clients (no assignment/scoping table) — potential tenant‑isolation issue if experts should be scoped (BLOCKER · HIGH — needs a product decision + `expert_assignments` table + migration). Expert can view (Point A/GRI/pulse) + comment (real), but **cannot** confirm/reject/edit AI insights or create an expert version of Point B (master‑spec §15.2/§19 gaps). Expert actions aren't logged.

**Metrics** — resolver → `public.metrics` works end‑to‑end for survey‑sourced metrics; honest nulls, no production fabrication in the canonical path. Document/Prisma source adapters are stubs (coverage gap, not a bug).

---

## 4. Recommended next steps (for your review)

1. **Admin overview** — decide: real aggregates vs honest placeholders vs remove decorative sections (then I implement).
2. **Expert scoping** — confirm whether experts must be limited to assigned clients (drives an `expert_assignments` table + migration).
3. **AI provider** — provide one LLM key (recommend `OPENROUTER_API_KEY`) and I'll consolidate `point-a/point-b-analyzer` onto it + honest 503 when absent.
4. **GRI dual engine** — approve removing legacy `app/actions/gri.ts` / `/ai-scanner` path so the 62‑criteria assessment is the single source.
5. **Point B depth (your "в конце")** — expert version of the plan, progress/deviation tracking, migrate `clients/[id]/point-b` (expert view) to the new engine, AI strategy enrichment.
6. **ТЗ Этап 7** — `AIStart360_Client_Questions_and_Answers.md` (product/marketing) still to be produced.

## Environment notes
- `.env.local` (gitignored) holds the production Supabase creds you provided. **Restart the dev server after env changes** — `NEXT_PUBLIC_*` are inlined at compile time; a server started before `.env.local` existed fails hydration app‑wide (stuck skeletons). Dev server runs on `:53000`.
- DB writes performed this session: **only** Point B snapshot persistence (`point_b_analysis`, additive upsert) and current‑revenue survey upsert — both you authorized. No destructive ops, no migrations applied.
