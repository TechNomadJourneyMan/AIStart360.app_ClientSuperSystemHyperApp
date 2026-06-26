# Integration Report — `integration/full-pipeline`

Date: 2026-05-29
Base: `claude/suspicious-grothendieck-862aff` @ `9167ac1`
Branch: `integration/full-pipeline` (29 commits ahead of base; 15 authored here —
14 `--no-ff` merge commits + 1 lint chore)
Status: **all test gates green** (modulo known pre-existing failures). Unpushed,
ready for human review + fast-forward.

## 1. Merge order executed

All 14 feature branches share merge-base `aa29777` (the commit immediately
before the 9 base commits). A normal 3-way `git merge --no-ff` therefore keeps
base files correctly — the large 2-way `git diff` deletion counts were artifacts
of the older branch point, not real deletions.

**Wave 1 — zero/low-conflict backend**
1. WM-D MCP package (`fb17bea`) — clean, `tools/mark-analytics-mcp/` only.
2. C4 kz_stat spider (`3682f6c`) — conflicts in `workers/main.py`, `jobs/__init__.py`.
3. C5 persons (`a2d01b2`) — clean auto-merge (`api/v1/__init__.py`).

**Wave 2 — migrations (renumbered as merged)**
4. WM-F saved lists (`530aa11`) — clean; migration `0007 → 0011`.
5. C1 trust signals (`d6db1ae`) — conflict in `models/company.py`; migration `0008 → 0012`.
6. WM-C alerts (`5398b92`) — conflict in `workers/main.py`; migration `0006 → 0013`.
7. WM-E region risk (`da377b0`) — conflicts in `workers/main.py`, `jobs/__init__.py`; migration `0006 → 0014`.
8. WM-G1 widget backend (`dc486ef`) — conflict in `api/v1/__init__.py`; migration `0006 → 0015`.

**Wave 3 — frontend (highest conflict last)**
9.  Ph2 B WidgetGrid (`8269a98`) — clean auto-merge (`package.json` union).
10. Ph2 A viewport bbox (`b4a3271`) — conflict in `routes/index.tsx` (re-applied to `admin.tsx`).
11. Ph2 C heatmap (`597416d`) — conflict in `directoryFilter.ts`.
12. Ph2 D tenders (`98aeb91`) — clean auto-merge (`useAnalytics.ts`).
13. Ph2 E news (`dd9e10e`) — conflict in `api/v1/__init__.py`.
14. WM-G2 widget frontend (`b700a97`) — conflicts in `package.json`, `vite-env.d.ts`, 3 locales.

Plus `chore(lint)`: removed 3 unused `noqa` directives introduced by merges.

## 2. Conflicts and resolutions

| File | Branch(es) | Resolution |
| --- | --- | --- |
| `backend/app/workers/main.py` | C4, WM-C, WM-E | Union all task imports + `functions` + `cron_jobs`: `egov_enrich`, `digest_runner`, `crawl_kz_goszakup_daily`, `kz_stat_refresh`, `release_pending_alerts`, `refresh_region_risk_index` all coexist. |
| `backend/app/jobs/__init__.py` | C4, WM-E | Kept a single merged docstring; no code in this file. |
| `backend/app/models/company.py` | C1 (vs base D3) | Union: `enriched_at_egov` (base) + `data_freshness_at` / `confidence_band` (C1). Comment renumbered to migration 0012. |
| `backend/app/api/v1/__init__.py` | C5/WM-F (clean) + WM-G1, Ph2 E (conflict) | Union router tuples: persons, tenders, alerts, trends, search, **digests, analyst, widgets, news**. No duplicate prefixes. `regions` already present on base (WM-E reused it). |
| `frontend/src/app/routes/index.tsx` | Ph2 A (vs base D1) | Kept base **overview** page (`--ours`). Re-applied Ph2 A's map simplification to `admin.tsx` instead (the old map console D1 renamed). |
| `frontend/src/app/routes/admin.tsx` | Ph2 A | Replaced manual `useCompaniesGeo` fetch + inline chips with `<MapShell />` self-fetch (`useRemote`) mode; chips now render inside MapShell. Removed now-unused import. |
| `frontend/src/stores/directoryFilter.ts` | Ph2 C (vs base C2) | Kept C2's **richer** store (`--ours`). |
| `frontend/src/components/widgets/IndustryHeatmapWidget.tsx` | Ph2 C | **Signature mismatch**: C's `setBoth(industry, region)` rewritten to C2's object arg `setBoth({ industry_code, region_kato })`. (The task brief said signatures matched — they did NOT.) |
| `frontend/package.json` | Ph2 B + WM-G2 | Union deps: `react-grid-layout` + `@types/react-grid-layout` (B) and `react-markdown` (G2). Lockfile regenerated via `npm install`. |
| `frontend/src/vite-env.d.ts` | WM-G2 (vs base) | Union env vars: `VITE_ENABLE_ADMIN` + `VITE_WIDGETS_API_READY`. |
| `frontend/src/locales/{en,kz,ru}.json` | Ph2 E + WM-G2 | `news` keeps `title/empty/error` (Ph2 E); added sibling `builder` block (WM-G2). |
| `frontend/src/components/map/MapShell.tsx` | Ph2 A + Ph2 C + WM-E + WM-G2 | **Four-way, auto-merged cleanly** — chips in `useRemote` mode (A), `directoryFilter` forwarded to `useCompaniesGeo` (C), risk metric in layer logic (WM-E, already on base), `compact?` prop hiding controls/legend (G2). All four capabilities verified present. |

## 3. Final migration chain (linear, single head)

```
...0004 → 0005_extend_sources
0006_digest_subscriptions       (base)
0009_companies_enriched_at_egov (base, down=0006)
0010_perf_indexes               (base, down=0009)
0011_saved_lists                (WM-F,  was 0007, down=0010)
0012_trust_signals              (C1,    was 0008, down=0011)
0013_alert_channels_quiet_hours (WM-C,  was 0006, down=0012)
0014_region_risk_index          (WM-E,  was 0006, down=0013)
0015_user_widgets               (WM-G1, was 0006, down=0014)
```

Verified against a live Postgres (`mark-postgres` container):
- `alembic heads` → `0015 (head)` (exactly one).
- `alembic upgrade head` on a fresh DB → clean (all 15 steps).
- `alembic downgrade base` → clean (full reverse).

## 4. Test results (before → after)

| Gate | Baseline (base `9167ac1`) | After integration |
| --- | --- | --- |
| Backend `pytest` | 73 passed, 4 failed | **213 passed, 4 failed, 1 skipped** |
| Backend `ruff check .` | 294 errors (pre-existing) | **294 errors** (no net increase) |
| Frontend `tsc --noEmit` (no routeTree.gen) | 19 errors | **11 errors** |
| Frontend `tsc --noEmit` (after `vite build` generates routeTree) | n/a | **6 errors** |
| Frontend `eslint .` | 2 errors, 6 warnings | **1 error, 7 warnings** |
| Frontend `vite build` | passes | **passes** |
| MCP `pytest` | n/a | **15 passed** |

### Known / pre-existing failures (NOT regressions)
- `tests/api/test_quota.py` — 3 tests (`test_free_user_searches_limit`,
  `test_starter_user_unlimited_search`, `test_free_user_cannot_forecast`).
  Disabled tier gates per commit `c3ed98b`. Documented as known.
- `tests/api/test_sources.py::test_list_sources_filter_by_category` — fails only
  in the full-suite run with `RuntimeError: Event loop is closed`. This is an
  asyncpg/event-loop teardown flake from the **session-scoped** `event_loop`
  fixture in `tests/conftest.py` colliding with function-scoped asyncpg
  connections; the exact test that trips it changes with run order (in isolation
  a *different* sources test fails). Pre-existing environmental issue, present on
  the base branch too. Not chased.

### Frontend typecheck note
`src/app/routeTree.gen.ts` is **gitignored** (a build artifact regenerated by the
TanStack Vite plugin). Both baseline (19) and integration (11) typecheck numbers
were measured with it absent, so the delta (−8) is apples-to-apples. Of the 11,
5 are `routeTree.gen`-dependent (`router.ts`, `index.tsx`, `admin.tsx`,
`companies.tsx`, `dashboard.tsx`) and vanish once the tree is generated — leaving
**6 genuine pre-existing errors** (CompanyDeepDrawer ×2, OverviewTab, TimelineTab,
MapShell, colorScale). The merges INTRODUCED zero new genuine type errors and
RESOLVED 8 baseline ones (notably the 8 in `IndustryHeatmapWidget.tsx`, fixed by
Ph2 C's rewrite). The full production `vite build` (which runs `tsc -b`) succeeds.

## 5. Partially-disabled features / TODOs

None. No track's feature had to be disabled to get the gates green. Every merged
branch's own test suite passes (C4 13, C5 7, WM-F 13, C1 18, WM-C 41, WM-E 5+1skip,
WM-G1 widgets, Ph2 D tenders 1, Ph2 E news 3, MCP 15).

TODOs for a follow-up (out of scope for this integration):
- The session-scoped `event_loop` fixture flake in `tests/conftest.py` should be
  switched to function scope (or `pytest-asyncio`'s loop management) to make the
  full suite deterministic.
- The 6 remaining pre-existing frontend type errors (drawer tabs / colorScale /
  MapShell) predate this work and should be triaged separately.
- `@types/react-grid-layout` was merged into `dependencies` (Ph2 B's placement);
  consider moving it to `devDependencies`.
