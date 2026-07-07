# 06 — Performance & Mobile-Speed Audit (AIStart360)

**Date:** 2026-07-07 · **Auditor scope:** PERF · **Stack:** Next.js 14.2 App Router · React 18.3 · Prisma 5 + Supabase (shared Postgres) · @tanstack/react-query 5 · Zustand · Tailwind · framer-motion · recharts · OpenRouter · @ducanh2912/next-pwa (Workbox)

> **Verification note.** This worktree has **no `node_modules`**, so `next build`, bundle-analyzer, Lighthouse, and runtime profiling were **not run**. Every finding below is grounded in source (`file:line`) and verified against the current tree (branch `claude/zen-swirles-7be268`, HEAD `8deeb51`). Findings that require a live build/device to quantify are explicitly marked "must measure" with the exact method. **No source was modified** — the only write is this report.

---

## 1. Summary

The prior `docs/AUDIT-performance-2026-07-01.md` work is **partially applied and verified in code**: AI-call timeouts (`AbortSignal.timeout`), the rate-limiter `opts.max` fix, server-side auth dedup via React `cache()` on `getAdminSession`, honest `/api/metrics` 500 status, the SW cross-user cache fix (API = `NetworkOnly`), and recharts→`next/dynamic` on all six chart surfaces are **all present**. The largest un-applied items remain the highest-leverage ones: **(1)** the FK-index migration exists in `prisma/schema.prisma` (31 `@@index`) but has **no corresponding `supabase/migrations/*.sql`** and is therefore **not applied to the shared Postgres** — slow FK scans persist under load; **(2)** the auth path still costs **~2 network round-trips per navigation** in middleware (`getUser` + `profiles`) **plus** a full client-side `auth.store.init()` (`getUser` + `profiles` again) on every mount, so the client half of the dedup is still open; **(3)** fonts are still **render-blocking**: five Google Font families + the full-axis Material Symbols variable font load via `<link rel=stylesheet>` (no `next/font`), and 909 icon references + 17 hardcoded `JetBrains Mono` strings block a clean migration; **(4)** data-fetching is still **84 raw `useEffect`+`fetch` components vs 7 react-query hooks**, with `onboarding/status` fetched by 6 components and `gri/assessment` by 9 (no dedup/cache); **(5)** two polling loops are unbounded/aggressive (`/api/health` every 5 s with a DB `SELECT 1`; documents every 10 s with no terminal condition); and **(6)** **170 routes are `force-dynamic`** with only 2 `unstable_cache`/`revalidate`, so almost nothing is CDN-cacheable. Good baseline hygiene is in place: 28 route-level `loading.tsx` skeletons, a branded preloader, no heavy server libs (xlsx/pdf/tesseract) leaking to the client, and the mascot assistant lazy-loaded via `next/dynamic`.

---

## 2. Findings

| ID | Sev | Area | Issue | Evidence (file:line) | Recommended Fix | Acceptance Criteria |
|---|---|---|---|---|---|---|
| PERF-01 | High | DB / index | FK indexes exist in Prisma schema (31 `@@index`) but **no migration applies them** to the shared Postgres; no `prisma/migrations/` dir and no `supabase/migrations/*.sql` creates them. FK scans stay sequential under load. | `prisma/schema.prisma` (31 `@@index`); `supabase/migrations/` has 001–040, none add these indexes; no `prisma/migrations/` dir | Add a `supabase/migrations/041_fk_indexes.sql` using `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for each FK/composite in the schema; apply via `node scripts/apply-migration.js`. | `EXPLAIN` on `clients by managerId`, `documents by clientId`, `metrics by clientId` uses `Index Scan`; indexes visible in `pg_indexes`. |
| PERF-02 | High | Auth / data | Auth resolved **~2× per navigation** in middleware (`updateSession`→`getUser` + `resolveRole`→`profiles`) **and again fully client-side** on every mount via `auth.store.init()` (`getUser` + `buildUserFromSession`→`profiles`). Server `cache()` covers only intra-request API guards, not this cross-layer duplication. | `middleware.ts:110,113,58-64`; `stores/auth.store.ts:139-152,92-97`; `app/providers.tsx:15-17` | Seed Zustand from the `x-user-role` header already set at `middleware.ts:116` (or a server layout prop) and skip `init()` when a session cookie + role are present; only call `getUser` when no seed exists. | Network tab on a warm navigation shows **0** client `/auth/v1/user` + `profiles` calls when role is already known; TTFB measured before/after. |
| PERF-03 | High | Fonts / LCP·CLS | Render-blocking fonts: 5 Google families (Bricolage, DM Sans, JetBrains Mono, Space Grotesk, Inter) + **full-axis** Material Symbols (`wght,FILL@100..700,0..1`) via `<link rel=stylesheet>`. No `next/font` (0 usages). `display=swap` avoids FOIT but causes FOUT/CLS; the stylesheet request itself still blocks. | `app/layout.tsx:44-51`; `next/font` grep = 0 hits; Material Symbols axis at `:49` | Migrate body/headline/mono to `next/font/google` (self-host, subset, `swap`); pin Material Symbols to needed weights/fill or subset the icon set. Blocked by PERF-13. | No request to `fonts.googleapis.com` in the critical path; fonts self-hosted from `/_next`; CLS < 0.1 (Lighthouse mobile). |
| PERF-04 | High | Data fetching | **84** components fetch via raw `useEffect`+`fetch`; only **7** react-query hooks exist. No dedup/cache/persist for high-frequency endpoints. `onboarding/status` fetched by **6** components, `gri/assessment` by **9**, so the same endpoint is hit multiple times per page. | grep: 84 raw-fetch components vs 7 `useQuery/useMutation`; `onboarding/status` → `app/client/onboarding/page.tsx`, `components/point-a/v2/PointAQuickPills.tsx`, `components/layout/UploadFilesNavItem.tsx`, `components/dashboard/OnboardingStatusBadges.tsx`, `components/layout/MobileNav.tsx`, `components/dashboard/GrowthSnapshotHero.tsx`; `gri/assessment` × 9 | Add shared `useOnboardingStatus()` / `useGriAssessment()` react-query hooks (one `queryKey` each) and migrate all consumers; `PersistQueryClientProvider` is already configured. | Network tab: **1** request per shared `queryKey` per page load; cache-hit on remount/nav. |
| PERF-05 | Medium | Caching | **170** routes/segments declare `force-dynamic`; only **2** use `unstable_cache`/`revalidate`. Almost nothing is CDN/ISR-cacheable; every GET pays full server compute + auth. | grep: 170 `force-dynamic` files under `app/`; 2 `unstable_cache`/`revalidate` | Audit deterministic GET routes (catalogs, filters, public share, static metadata) and switch to `revalidate`/`unstable_cache`; keep `force-dynamic` only where per-request user data is truly required. | ≥10 read-only routes serve from cache (`x-vercel-cache: HIT` or `Cache-Control` present); no correctness regressions. |
| PERF-06 | Medium | Polling | `SystemHealth` polls `/api/health` every **5 s** with **no in-flight guard**; the route runs a DB `SELECT 1` + external `fetch`es on every hit → steady backend load per open dashboard tab. | `components/dashboard/SystemHealth.tsx:20` (`POLL_INTERVAL_MS = 5_000`), `:51-55`; `app/api/health/route.ts:15,31,51` | Raise interval to 30 s, add an `inFlight` ref guard, and pause when `document.hidden`. | Interval ≥30 s; no overlapping requests; polling stops on hidden tab. |
| PERF-07 | Medium | Polling | Documents page polls `fetchDocs` every **10 s** with **no terminal condition** — runs forever even when all docs are terminal. | `app/client/onboarding/documents/page.tsx:395` | Stop the interval when no document is `queued`/`processing`; restart on new upload. | Interval clears once all docs settle; Network shows no polling at rest. |
| PERF-08 | Medium | Rendering | Very large `'use client'` modules hydrate wholesale: `GRICalculator` **1764**, `pulse/page` **1288**, `MetricsPageClient` **1015**, `MarketAnalysisChecklist` **1013**, `PointBView` **1008**. `PointBView` has **0** memoization (`React.memo`/`useMemo`/`useCallback` all 0) over 1008 lines. | `wc -l` on each; `PointBView.tsx` memo/useMemo/useCallback = 0/0/0 | Split into an RSC shell + focused client leaves; memoize derived data and stable callbacks in the hottest components. | First-Load JS for these routes drops (bundle-analyzer before/after); INP < 200 ms on interaction (must measure). |
| PERF-09 | Medium | Toasts | Two toast systems mounted globally at once: `sonner` `<Toaster>` (`app/layout.tsx:58`) **and** a custom `<ToastContainer>` (`app/providers.tsx:57`). Duplicate runtime + listeners on every page. | `app/layout.tsx:58`; `app/providers.tsx:57`; `components/ui/Toast.tsx` | Standardize on one toast library; remove the other and its provider. | Exactly one toast system mounted; toasts still fire from all call sites. |
| PERF-10 | Low | DB / ingest | Embeddings persisted with a **per-chunk sequential `$executeRaw INSERT`** loop (unbounded by chunk count). Low current impact (embeddings appear unpopulated) but O(n) round-trips when enabled. | `lib/documents/embed.ts:115-138` | Batch into a single multi-row `INSERT ... VALUES (...),(...)`. | One INSERT per document; row count unchanged. |
| PERF-11 | Low | Images | 3 raw `<img>` for the logo instead of `next/image` (12 files already use `next/image`). Minor; SVG so no resize benefit, but no lazy/priority control. | `app/admin-giga-panel/page.tsx:71`, `app/giga-login/page.tsx:62`, `components/giga-panel/GigaSidebar.tsx:69` | Use the existing `components/ui/Logo.tsx` / `next/image`, or leave as-is (SVG, low cost). | Consistent logo component; no CLS from logo. |
| PERF-12 | Low | Dead code | Dead recharts leaves ship no bundle cost but are unreferenced: `GRIAssessmentTrendChart` (no importers) and `ChartModal` (no importers, statically imports `KpiChart`). | `components/point-a/GRIAssessmentTrendChart.tsx` (0 importers); `components/dashboard/ChartModal.tsx:10` (0 importers) | Delete both, or wire `ChartModal` behind `dynamic()` if intended for use. | Files removed or dynamically imported; no build reference. |
| PERF-13 | Low | Fonts (blocker) | **17** hardcoded `'JetBrains Mono'` `fontFamily` strings (chart tick labels, PDF gen) + **909** Material Symbols icon-class references block a clean `next/font` migration (hashed family names would break inline refs). Documented as the reason PERF-03 was deferred. | grep: 17 inline `JetBrains Mono`; 909 Material Symbols refs | Centralize the mono family behind a CSS variable (`--font-mono`) used by both charts and PDF; then migrate to `next/font`. | 0 hardcoded family strings; charts/PDF read `--font-mono`. |
| PERF-14 | Info | Bundle tooling | No `@next/bundle-analyzer` and no CI JS budget → bundle regressions are invisible. | grep `bundle-analyzer`/`ANALYZE` in `next.config.mjs`/`package.json` = 0 | Add `@next/bundle-analyzer` (gated by `ANALYZE=true`) and a First-Load-JS budget check in CI. | `ANALYZE=true next build` produces a report; CI fails on budget breach. |

---

## 3. Target metrics

| Metric | Target | How to measure |
|---|---|---|
| Mobile initial load (cold, dashboard) | < 3.5 s to interactive on Fast 3G / mid-tier mobile | Lighthouse **mobile** (throttled) on `/dashboard` after login |
| LCP (mobile) | < 2.5 s | Lighthouse mobile + field CrUX / `web-vitals` |
| CLS | < 0.1 | Lighthouse + `web-vitals` (watch font swap, late-mounting widgets) |
| INP | < 200 ms | `web-vitals` field data; React Profiler on `PointBView`/`GRICalculator` interactions |
| FCP | < 1.8 s | Lighthouse mobile |
| TBT | < 200 ms | Lighthouse mobile |
| TTFB (warm nav) | < 0.8 s | `Server-Timing` / Network; re-measure after PERF-02 |
| First-Load JS (data routes: dashboard/pulse/point-b/metrics/market) | Establish baseline, then −150 KB gz target | `ANALYZE=true next build` (PERF-14) |
| API requests per dashboard load | Reduce by ≥5 duplicate requests | Network tab; count `onboarding/status` + `gri/assessment` before/after PERF-04 |
| `/api/health` backend load | ≤1 req / 30 s / tab, no overlap | Network tab + server logs after PERF-06 |
| AI route latency ceiling | ≤ 45 s hard cap (already enforced) | OpenRouter/Langfuse logs (verified in code) |
| Image budget (public/) | No asset > 200 KB in critical path | `find public -type f -size +200k` — currently **clean** (0 hits) |

---

## 4. Prior-perf status (from `AUDIT-performance-2026-07-01.md`)

**Applied & verified in current code:**
- **B01 AI timeouts** — `lib/ai/openrouter.ts:133,146,155,199` (`AbortSignal.timeout(45s/20s)`, `TimeoutError` handling). ✅
- **B05 rate-limit `opts.max`** — `lib/rate-limit.ts:17,26,86` (per-`(max,window)` limiter cache). ✅
- **B07 (server half)** — `getAdminSession` wrapped in React `cache()` at `lib/rbac.ts:107`. ✅ (client half still open → PERF-02)
- **B12 honest metrics status** — `app/api/v1/metrics/route.ts:42` returns **500**. ✅
- **F01 recharts → dynamic** — all 6 surfaces wrapped: `WidgetGrid.tsx:16` (KpiChart), `KpiCardsGrid.tsx:14` (MetricModal), `pulse/page.tsx:11` (GriPulseWidget), `MetricsLiveCatalog.tsx:18` (MetricDrillDownModalV2), `PointBView.tsx:33` (TrajectoryChart), `MarketAnalysisChecklist.tsx:22` (MarketDataPanel); also `GRIAssessment.tsx:7`, `MiniGriWizard.tsx:9`. ✅
- **SW cross-user cache leak** — `next.config.mjs:20-35`: `/api/*` = `NetworkOnly`, images `StaleWhileRevalidate`, static `CacheFirst`; logout wipes `caches` + rq blob (`auth.store.ts:297-305`). ✅
- **F04 (assistant lazy)** — `MascotLauncher` loads `MascotAssistant` via `dynamic()` (`MascotLauncher.tsx:18`). ✅ (partial — launcher itself is static, panel is lazy)
- **F07 / cleanup** — `react-grid-layout` removed; heavy server libs (xlsx/pdf-parse/tesseract/pdfkit/mammoth) confirmed **not** leaking into any `'use client'` file. ✅
- **28 `loading.tsx` skeletons + branded preloader** (`app/loading.tsx`). ✅

**Pending / not applied:**
- **B16 FK indexes** — in schema, **not migrated** to Postgres → **PERF-01**. ❌
- **B07 client dedup** — `auth.store.init()` still re-fetches `getUser`+`profiles` every mount → **PERF-02**. ❌
- **F03 next/font** — still render-blocking `<link>` fonts, blocked by inline family refs → **PERF-03 / PERF-13**. ❌
- **U01/U02 react-query dedup** — 84 raw fetch vs 7 hooks → **PERF-04**. ❌
- **U10 health poll (5 s, no guard)** → **PERF-06**; **U09 documents poll (no terminal cond.)** → **PERF-07**. ❌
- **B10 batch embeddings** → **PERF-10**. ❌
- **F06 duplicate toasters** → **PERF-09** (still two systems). ❌
- **Bundle analyzer / CI JS budget** → **PERF-14**. ❌

---

## 5. Product-owner questions

1. **FK-index rollout (PERF-01):** Can we schedule a short maintenance window to apply `CREATE INDEX CONCURRENTLY` on the shared Supabase Postgres, or should this run off-peak with monitoring? This is the single highest-leverage backend latency fix.
2. **Caching posture (PERF-05):** Are any dashboard reads safe to serve stale for 30–60 s (e.g. catalogs, filters, public share pages)? A little staleness would let us drop `force-dynamic` on many routes and cut TTFB.
3. **Font/brand fidelity (PERF-03/13):** Migrating to `next/font` requires re-pointing 17 hardcoded `JetBrains Mono` chart/PDF references at a CSS variable and re-verifying chart labels + PDF export visually. Is a design/QA pass acceptable, or do we keep the current (slower) render-blocking fonts for now?
4. **`/api/health` widget (PERF-06):** Is the 5-second live status widget a product requirement, or can we relax it to 30 s (or make it on-demand)? Each open tab currently hits the DB every 5 s.
5. **Measurement gate:** Do you want a one-time Lighthouse-mobile + bundle-analyzer baseline captured (requires `npm install` + `next build`) before we apply PERF-02/03/04, so we can quantify each fix's before/after?
