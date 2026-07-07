# 09 — Dashboard & Widget Customization — Audit + Spec

Auditor: Dashboard & Widget-Customization architect
Date: 2026-07-07
ID prefix: `DASH`
Scope: current dashboards (client / staff / medical / ecommerce) + design of a customizable-dashboard system.
Constraint: read-only audit — the only write is this report.

---

## 1. Executive summary

The portal has **four distinct dashboard surfaces**, all with **hardcoded, hand-composed JSX layouts** and essentially **no user-facing customization in production**. A genuine widget-customization engine already exists — `components/dashboard/WidgetGrid.tsx` (498 lines: registry catalog, add/remove/reorder, edit mode, empty state, `localStorage` persistence) — but it is (a) mounted **only on the admin/staff dashboard branch**, (b) fed **empty data arrays** for 3 of its 6 widgets, and (c) persisted only to **`localStorage`**, so it does not survive device changes and is invisible to the ~majority "client" audience. Two DB persistence surfaces already exist on `profiles` — `widget_config jsonb` (migration 034, admin-controlled allowlist, **write-only / never read at render**) and `preferences jsonb` (migration 035, self-scoped, RLS-safe, deep-merge API at `/api/v1/settings/preferences`) — the latter is the ideal home for user layouts. The recommended path is: **generalize `WidgetGrid` into a role-aware, registry-driven engine, feed it real data, and persist per-user layout to a new `dashboard_layouts` table (or `profiles.preferences.dashboard`) via the proven self-scoped pattern**, using **`@dnd-kit`** for reordering (note: `react-grid-layout` was already tried and removed for bundle weight — do not reintroduce it). MVP = client dashboard, add/remove/reorder + reset, DB-persisted, mobile move up/down. This is a net-new feature; the existing `WidgetGrid` is a strong starting scaffold, not a finished product.

---

## 2. Current dashboard map

| Route / file | Type | Audience (via `middleware.ts`) | Layout | Widget system? | Data source | Persistence today |
| --- | --- | --- | --- | --- | --- | --- |
| `app/(dashboard)/dashboard/page.tsx` (629 ln) | Server | **client branch** (role≠admin/expert/owner/manager) AND **admin branch** — one file, two full render trees split at line 250 | Hardcoded JSX; client branch = ~15 fixed `<section>`s (Point A), admin branch = fixed hero + 3-col grid | Only admin branch mounts `WidgetGrid` (line 589). Client branch has **none**. | Client: Supabase REST (`diagnostics`, `companies`, `survey_answers`, `documents`, lines 262-296). Admin: `getDashboardExtendedData()` Supabase (lines 64-117) + Prisma `adminRequest`/`client` (lines 454-467) + `getPortfolioGRI()` | None per-user (server-rendered). WidgetGrid uses `localStorage` only. |
| `app/(dashboard)/dashboard/loading.tsx` (38 ln) | Server | route-level Suspense | Fixed skeleton: 4 KPI + table + 2 charts | n/a | n/a | n/a |
| `app/client/dashboard/page.tsx` (13 ln) | Server | any client | **Redirect stub** → `/client/point-a` (line 11) | none | none | none |
| `app/client/dashboard-ecommerce/page.tsx` (622 ln) | Client (`'use client'`) | **soft-orphan** — reached via the vertical onboarding funnel (`welcome→set-vertical→onboarding-ecommerce→dashboard-ecommerce`, redirect `onboarding-ecommerce/page.tsx:248`), but **no nav/sidebar entry** (0 hits in `components/`, `lib/navigation.ts`). NOT in `CLIENT_DASHBOARD_PATHS`. | Hardcoded JSX: `Hero→KpiRow→FunnelSankey→ChannelMix→MarketplacesStrip→SkuHealth→[RFM|Cohort]→CartRecovery→Seasonality→GoalsStrip` (lines 113-135) | none | **100% mock** — frozen `const DATA = {…} as const` (lines 16-96); no Supabase/Prisma/fetch | none |
| `app/client/dashboard-medical/page.tsx` (446 ln) | Client (`'use client'`) | **soft-orphan** — reached via vertical funnel (`onboarding-medical/page.tsx:114` redirect + `scenarios/page.tsx:38` link); no nav entry. NOT in `CLIENT_DASHBOARD_PATHS`. | Hardcoded JSX gated on data: `KpiStrip→DownloadActions→SegmentsBlock→LossesBlock→BundlesBlock→ExpertComments` (lines 146-161) | none | **Real** — `POST /api/medical/audit/run` (lines 75-79); only presentational literals hardcoded (color maps 259-268, 310-315) | Transient `expandedKey` accordion state only (line 348). No persisted prefs. |

### 2.1 The existing "widget system" — `components/dashboard/WidgetGrid.tsx` (498 ln, `'use client'`)

This is the closest thing to the requested feature and the single most important artifact for the spec.

- **Registry catalog** (`CATALOG`, lines 36-48): 6 widget types — `alerts`, `activity`, `gri`, `metrics`, `chart`, `quick-links` — each `{ label, description, icon, span }`. `span ∈ 'full' | 'two-thirds' | 'third'` (lines 50-54).
- **Default layout** (`DEFAULT_WIDGETS`, lines 56-60): `alerts`, `activity`, `gri`.
- **Flows implemented**: add via right-side drawer (`AddWidgetDialog`, Radix `Dialog`, lines 266-339); remove (line 386); **reorder = move up/down buttons** (`moveWidget`, lines 390-400) — no drag-and-drop; reset to default (line 402); edit-mode toggle (line 355).
- **Empty state** (lines 470-486): "Дэшборд пуст. Добавьте виджеты." + CTA.
- **Persistence** (lines 359-379): `localStorage` key `aistart360_dashboard_widgets_v2` (per-user suffix if `userId` passed, but `page.tsx` does **not** pass `userId` → shared key). Stale-type filter on load (line 368).
- **Perf**: `KpiChart` (recharts) is `next/dynamic`, `ssr:false` (lines 16-19) — good, keeps recharts out of first-load JS.
- **Animation**: Framer Motion `layout` + `AnimatePresence` (lines 210-217, 453).

**Critical gap**: on the admin dashboard it is passed `activity={[]} gri={[]} metrics={[]}` (page.tsx lines 591-593) — 3 of its 6 widget types render **empty** even when added. Only `alerts` receives real data.

### 2.2 Existing persistence surfaces (already migrated)

- `profiles.widget_config JSONB` — migration `034_fix_subscription_fk_and_widget_config.sql:14`. Written by `POST /api/giga-admin/users/[id]/widgets` (super-admin only, line 48) as a `string[]` allowlist; read back only in the giga user-list (`app/api/giga-admin/users/route.ts:69`). **Never read at dashboard render** (grep confirms no consumer outside `giga-admin/`). This is an admin "which widgets is this user allowed to see" list — orthogonal to user-owned layout.
- `profiles.preferences JSONB NOT NULL DEFAULT '{}'` — migration `035_profiles_preferences.sql:6`. Self-scoped read/deep-merge via `/api/v1/settings/preferences` (RLS-safe, `auth.getUser()` + `.eq('id', user.id)`, GET line 24 / PATCH line 42). This is the **proven pattern** to reuse for layout persistence.

### 2.3 Routing reality (`middleware.ts`)

- Role → landing: `admin→/dashboard`, `owner→/owner/dashboard`, `client→/dashboard`, else `/expert/dashboard` (lines 148-151).
- `CLIENT_DASHBOARD_PATHS` (lines 28-31) does **not** include `dashboard-medical` or `dashboard-ecommerce` → those two are effectively orphan/vertical demo surfaces, not part of the standard client dashboard flow.

---

## 3. Findings

| ID | Sev | Area | Issue | Evidence (file:line) | Fix | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| DASH-01 | High | Persistence | Widget customization persists only to `localStorage` → lost on new device/browser, not portable, no cross-session/server render. | `WidgetGrid.tsx:62,362,377` | Persist layout to DB (`dashboard_layouts` table or `profiles.preferences.dashboard`) via self-scoped API mirroring `/api/v1/settings/preferences`. | User customizes on device A, signs in on device B, sees same layout. Verified by DB row + reload. |
| DASH-02 | High | Coverage | The only customization UI (`WidgetGrid`) is mounted **only in the admin/staff branch**; the client audience (the product's core users) gets a fully hardcoded dashboard with zero customization. | `page.tsx:589` inside `if (isAdmin)` tail; client branch (lines 305-448) has no `WidgetGrid` | Ship the customizable grid to the **client** dashboard as the primary surface. | A logged-in client can add/remove/reorder widgets on `/dashboard`. |
| DASH-03 | High | Data integrity | 3 of 6 registered widgets are fed empty arrays on the admin dashboard, so `activity`/`gri`/`metrics` render blank even when added. | `page.tsx:590-595` (`activity={[]} gri={[]} metrics={[]}`) | Wire each widget to a real data source (server props or per-widget client fetch); see §4.2 data-source column. | Every catalog widget renders real data or an explicit empty state; none renders a silently blank body. |
| DASH-04 | High | Reorder UX | Reorder is move up/down buttons only — no drag-and-drop on desktop; slow for many widgets; not discoverable. | `WidgetGrid.tsx:390-400,227-240` | Add `@dnd-kit/sortable` DnD for desktop; keep up/down as the accessible + mobile fallback. | Desktop user drags a widget to a new position; order persists. Keyboard + up/down still work. |
| DASH-05 | Medium | Dead surface | `profiles.widget_config` is written by the giga panel but **never read** at render → admin "widget visibility" control has no effect on any dashboard. | `034_...:14`; write `giga-admin/users/[id]/widgets/route.ts:48`; no render-time reader (grep) | Either consume `widget_config` as a per-user allowlist in the registry filter, or deprecate it. Decide in §7 Q. | Admin-set visibility either measurably filters the user's widget catalog, or the column/route is removed. |
| DASH-06 | Medium | Mobile density | E-commerce dashboard uses `grid-cols-12` for the 12-month seasonality bars with no collapse → 12 hair-thin bars on mobile; heatmaps use fixed-col `aspect-square` cells (tiny tap targets). | `dashboard-ecommerce/page.tsx:549` (`grid-cols-12`), `:407,431,470` | Make bar charts horizontally scrollable or switch to a responsive chart; enforce min tap target 44px on heatmap cells. | On a 375px viewport, no chart overflows the body; heatmap cells ≥ 44px or scroll. |
| DASH-07 | Medium | Mock data | E-commerce dashboard is 100% fabricated (`DATA` const) with no data layer, no auth, and no loading/empty/error states — misleading if shipped as-is. | `dashboard-ecommerce/page.tsx:16-96`; no auth check in file | Gate behind auth + real integration (`lib/integrations/ecommerce/`) or clearly label as demo and remove from any live nav. | Route either shows real per-user data (auth-gated) or is explicitly a labelled demo not reachable by real clients. |
| DASH-08 | Medium | Consistency | No unified loading/empty/error contract across widgets: some have skeletons (`KpiCardsGrid` `MetricCardSkeleton` :25, medical `LoadingSkeleton` :433), some have empty states (`GriDiagramWidget` "Нет данных" :113, `CrmActivity` "Нет заявок" :99, `ActivityFeed` "Нет активности" :37), e-commerce has none. **No standard error state anywhere**, and `GrowthSnapshotHero` silently swallows fetch failures (`catch {}` at :143-145) → blank/`—` placeholders with no signal. | as cited | Define a `WidgetShell` that standardizes loading/empty/error; wrap every registered widget; surface fetch errors instead of swallowing. | Every registered widget renders one of {loading, empty, error, content}; visually consistent; fetch failures show a retry error state. |
| DASH-09 | Medium | Role differentiation | The client vs admin split is a giant `if` inside one 629-line file; there is no declarative per-role default layout — impossible to reason about or extend to owner/expert/medical/ecommerce verticals. | `page.tsx:226-450` (client tree) vs `452-627` (admin tree) | Replace the branch with a role→default-layout map consumed by the registry engine (§4.3). | Adding a new role's default layout is a config edit, not a new JSX tree. |
| DASH-10 | Low | Shared localStorage key | `WidgetGrid` accepts `userId` for a per-user key but `page.tsx` never passes it → all users on a shared browser (e.g. giga kiosk) collide on one key. | `WidgetGrid.tsx:351-352`; `page.tsx:589-595` omits `userId` | Pass `userId`; better, move to DB (DASH-01) which is inherently per-user. | Two users on one browser have independent layouts. |
| DASH-11 | Low | Reset scope | "Сбросить" resets to a hardcoded `DEFAULT_WIDGETS` (admin default) regardless of role. | `WidgetGrid.tsx:402-404,56-60` | Reset to the **role-appropriate** default from the layout map. | Client reset yields client default; admin reset yields admin default. |
| DASH-12 | Low | Analytics | No analytics events on any customization action (add/remove/reorder/reset). | grep: no tracking calls in `WidgetGrid.tsx` | Emit events (§6) via existing `logActivity` (`lib/activity/log.ts:20`) or client analytics. | Each customization action produces one analytics event. |
| DASH-13 | Low | A11y of reorder | Move up/down buttons have no `aria-label`; icon-only (`arrow_upward`/`arrow_downward`, close), no announced position; DnD (once added) needs keyboard + screen-reader support. | `WidgetGrid.tsx:227-247` (icon-only buttons, no aria) | Add `aria-label`s; use `@dnd-kit` keyboard sensor + live-region announcements. | Screen reader announces "Move ‹widget› up/down, position N of M"; keyboard reorder works. |

---

## 4. Customizable-dashboard spec (DASH feature)

### 4.1 Architecture — registry-driven widget engine

Generalize the existing `WidgetGrid` into a **role-aware registry engine**. Three layers:

**(a) Widget registry** — a single typed manifest, `lib/dashboard/registry.ts` (net-new), each entry:

```ts
interface WidgetDef {
  id: WidgetId                 // stable string, persisted in layout
  title: string                // Russian label
  description: string
  category: 'overview' | 'activity' | 'ai' | 'tasks' | 'resources' | 'quick'
  size: { default: GridSpan; allowed: GridSpan[] }   // GridSpan = 'third'|'two-thirds'|'full'
  roles: Role[]                // which roles may see it (client|admin|expert|owner)
  vertical?: 'medical' | 'ecommerce' | null          // optional vertical scoping
  defaultEnabled: boolean      // in the role's default layout
  dataSource: 'server-prop' | 'client-fetch'         // how it gets data
  component: React.ComponentType<WidgetProps>
}
```

This extends the current `CATALOG` (`WidgetGrid.tsx:36-48`) with `category`, `roles`, `vertical`, `defaultEnabled`, and a `component` reference. Reuse the existing `span → col-span` mapping (`SPAN_CLASS`, lines 50-54).

**(b) Component model** — every widget is a self-contained component receiving a uniform `WidgetProps` and wrapped in a shared `WidgetShell` (net-new) that owns the card chrome + `{loading | empty | error | content}` states (fixes DASH-08). Data comes either as a server prop (SSR, fast first paint) or via a client hook (`dataSource: 'client-fetch'`, e.g. `useTimeseries` already used by `KpiChart.tsx:61`). This lets heavy widgets stay lazy (`next/dynamic`, as `WidgetGrid.tsx:16` already does for the chart).

**(c) Layout engine** — `DashboardGrid` (evolved `WidgetGrid`) reads the user's saved layout (or the role default), renders enabled widgets in order, and owns edit mode (add/remove/reorder/resize/reset). Persists via the layout API (§4.5).

### 4.2 First widgets to ship (registry seed)

| Widget id | Title (RU) | Category | Default span | Roles | Data source | Notes / reuse |
| --- | --- | --- | --- | --- | --- | --- |
| `progress-overview` | Обзор прогресса | overview | two-thirds | client | server-prop | Point A `overall_score`/`health_index` — from `diagToPointA` (page.tsx:194) |
| `recent-activity` | Последние события | activity | two-thirds | all | client-fetch | reuse `ActivityFeed` (has empty state :37) |
| `gri-suggestions` | Советы «Гри» | ai | third | client | client-fetch | mascot `/insight` (per MEMORY: OpenRouter) |
| `tutorials` | Обучение | tasks | third | client | client-fetch | onboarding/tutorial completion |
| `quick-actions` | Быстрый доступ | quick | third | all | static | reuse `QuickLinksWidget` (`WidgetGrid.tsx:152`) |
| `notifications` | Уведомления | activity | third | all | client-fetch | `/notifications` (migration 037 `app_notifications`) |
| `kpi-stats` | Ключевые метрики | overview | full | all | client-fetch | reuse `KpiCardsGrid` (`useAllVisibleMetrics` :188, has skeleton :25) |
| `saved-resources` | Сохранённые материалы | resources | third | client | client-fetch | net-new (needs source — see §7) |
| `tasks` | Задачи | tasks | third | all | client-fetch | net-new (needs task model — see §7) |
| `next-steps` | Рекомендуемые шаги | ai | two-thirds | client | server-prop | Point A `quick_wins`/`risks` (page.tsx:373,354) |
| `alerts` | Критические сигналы | activity | full | admin,expert | server-prop | reuse `AlertCard` (existing) |
| `gri-scoring` | Прогресс по GRI | overview | third | all | server-prop | reuse `GriWidget`/`GriDiagramWidget` (has empty state :113) |

Widgets marked "reuse" already exist; "net-new" ones are flagged in §7 because they need a backing data model.

### 4.3 Default layouts per role

Declarative map `lib/dashboard/defaults.ts` (net-new), replacing the `if (isAdmin)` branch (DASH-09):

- **client**: `progress-overview`, `next-steps`, `gri-scoring`, `recent-activity`, `gri-suggestions`, `quick-actions`
- **admin / expert (staff)**: `alerts`, `recent-activity`, `gri-scoring`, `kpi-stats`, `quick-actions` (mirrors current `DEFAULT_WIDGETS` + real data)
- **owner**: portfolio-level `kpi-stats`, `gri-scoring`, `alerts`
- **vertical (medical / ecommerce)**: seeded from the existing hardcoded sections, added as `vertical`-scoped widgets so those pages become registry-driven too (later phase)

Reset (DASH-11) restores the caller's role default, not a global constant.

### 4.4 User flows

- **Add**: edit mode → "Добавить" → right drawer catalog (reuse `AddWidgetDialog`, `WidgetGrid.tsx:266`), filtered by `roles`/`vertical`/`widget_config` allowlist, "Добавлен" badge on already-present (lines 315-316). On click → append + autosave.
- **Remove**: edit mode → per-card `×` (reuse lines 241-246) → remove + autosave.
- **Reorder — desktop**: `@dnd-kit/sortable` drag handle in edit mode; on drop → persist order.
- **Reorder — mobile**: keep up/down buttons (reuse `moveWidget` :390) as the primary mobile affordance; optional long-press to enter a drag state via dnd-kit `TouchSensor`.
- **Resize**: cycle span via the `size.allowed` list (a small "1/3 · 2/3 · full" segmented control in edit mode); only shown for widgets with >1 allowed span. Keeps the CSS-grid model (no free-form pixel grid → no `react-grid-layout`).
- **Save**: autosave (debounced ~500ms) on every mutation, matching current "Настройки сохраняются автоматически" copy (line 331). Optimistic UI + rollback on API failure.
- **Reset**: "Сбросить" → role default (DASH-11) with a confirm.

### 4.5 Backend persistence model

Recommended: a dedicated table (cleaner than nesting layout in the `preferences` bag; keeps layout queryable and RLS-scoped), following the self-scoped pattern proven by `/api/v1/settings/preferences`.

Migration sketch — `supabase/migrations/04X_dashboard_layouts.sql`:

```sql
-- Per-user, per-surface dashboard layout. Additive + idempotent.
CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface    text        NOT NULL DEFAULT 'main',   -- 'main' | 'medical' | 'ecommerce'
  role       text,                                   -- snapshot of role at save time (audit)
  layout     jsonb       NOT NULL DEFAULT '[]'::jsonb,
             -- [{ "id": "gri-scoring", "span": "third", "order": 0 }, ...]
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, surface)
);

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- Self-scoped RLS (mirrors the 036/037/038 self-scoped policy style).
DROP POLICY IF EXISTS dl_select_own ON public.dashboard_layouts;
CREATE POLICY dl_select_own ON public.dashboard_layouts
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS dl_upsert_own ON public.dashboard_layouts;
CREATE POLICY dl_insert_own ON public.dashboard_layouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY dl_update_own ON public.dashboard_layouts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Alternative (lighter, no migration friction)**: store under `profiles.preferences.dashboard` (column already exists, migration 035) and reuse the existing deep-merge endpoint verbatim — `PATCH /api/v1/settings/preferences` with `{ dashboard: { main: [...] } }`. Trade-off: not independently queryable, and deep-merge on arrays needs a replace semantic (the current `deepMerge` at `settings/preferences/route.ts:16` replaces arrays wholesale — which is actually correct for a layout array). **Recommendation: use the dedicated table for `surface`-scoping and clean RLS; fall back to `preferences.dashboard` only if migration cadence is a blocker.**

API surface (net-new, mirrors settings pattern): `GET/PUT /api/v1/dashboard/layout?surface=main` — `getUser()` → `.eq('user_id', user.id)` → return/upsert `layout`. RLS makes it safe even with the anon key.

### 4.6 Frontend library choice

**`@dnd-kit` (`@dnd-kit/core` + `@dnd-kit/sortable`)** — recommended.

- **Rationale**: accessible by design (keyboard sensor + screen-reader announcements → satisfies DASH-13), touch-friendly (`TouchSensor` + activation constraints for long-press mobile), headless (fits the bespoke glassmorphism cards, no imposed styles), actively maintained, React-18/Next-14 compatible. Composes with the existing Framer Motion `layout` animations already in `WidgetCard` (`WidgetGrid.tsx:210-217`).
- **Bundle cost**: `@dnd-kit/core` + `sortable` ≈ 10–15 KB gz — small; can be lazy-loaded only in edit mode so it never lands in first-load JS.
- **Rejected — `react-grid-layout`**: heavier (~30–40 KB gz + requires its CSS), imposes an absolute-positioned pixel grid that fights the responsive CSS-grid model and the design system, and was **already added and then removed from this repo** for bundle weight (per project memory / perf audit 2026-07-01). Do not reintroduce.
- **Rejected — `react-beautiful-dnd`**: effectively unmaintained; poorer a11y story than dnd-kit.

**Mobile behavior**: default to up/down buttons (reliable, already built); enable dnd-kit `TouchSensor` with a long-press activation delay for optional drag. Single-column stack on mobile (all spans collapse to full width) — the current CSS-grid spans already do this via the `lg:` breakpoints in `SPAN_CLASS`.

### 4.7 Loading / empty / error states (unified `WidgetShell`)

- **Empty dashboard**: reuse the existing empty state (`WidgetGrid.tsx:470-486`) — "Дэшборд пуст. Добавьте виджеты." + CTA; reset-to-default suggestion.
- **Widget loading**: skeleton inside the card (pattern already in `KpiCardsGrid.tsx:25` and `loading.tsx`). `WidgetShell` renders a generic pulse skeleton sized to `span`.
- **Widget empty**: per-widget "Нет данных" (pattern: `GriDiagramWidget.tsx:113`, `ActivityFeed.tsx:37`, `CrmActivity.tsx:99`).
- **Widget error**: **currently missing everywhere** — `WidgetShell` adds a compact error card ("Не удалось загрузить · Повторить") with a retry callback; client-fetch widgets surface fetch failures instead of silently blanking.

---

## 5. Accessibility of reordering (DASH-13)

- `aria-label` on up/down and remove buttons (currently icon-only, `WidgetGrid.tsx:227-247`).
- dnd-kit keyboard sensor: `Space` to pick up, arrows to move, `Space` to drop, `Esc` to cancel.
- Live-region announcements ("Виджет ‹название› перемещён на позицию N из M").
- Focus management: return focus to the moved card after reorder; edit-mode toggle is a labelled `button` with `aria-pressed`.
- Respect `prefers-reduced-motion` for the Framer Motion `layout` transitions.

---

## 6. Analytics events (DASH-12)

Emit via existing `logActivity` (`lib/activity/log.ts:20`) or a client analytics wrapper:

- `dashboard.widget.added` `{ widgetId, surface }`
- `dashboard.widget.removed` `{ widgetId, surface }`
- `dashboard.widget.reordered` `{ widgetId, from, to, surface }`
- `dashboard.widget.resized` `{ widgetId, from, to }`
- `dashboard.layout.reset` `{ surface, role }`
- `dashboard.editmode.toggled` `{ on: boolean }`

---

## 7. MVP vs later

**MVP (ship first)**
- Bring the registry-driven grid to the **client `/dashboard`** (DASH-02).
- Seed registry with the reuse-ready widgets: `progress-overview`, `next-steps`, `gri-scoring`, `recent-activity`, `gri-suggestions`, `quick-actions`, `kpi-stats`, `notifications`, `recent-activity`.
- Real data wired for every seeded widget (DASH-03).
- **DB persistence** via `dashboard_layouts` (or `preferences.dashboard`) + self-scoped API (DASH-01, DASH-10).
- Flows: add, remove, reorder (up/down + dnd-kit desktop), reset-to-role-default (DASH-04, DASH-11).
- Unified `WidgetShell` loading/empty/error (DASH-08).
- Mobile single-column + up/down (DASH-06 for the grid itself).
- Analytics + a11y (DASH-12, DASH-13).

**Later**
- Resize (span cycling) — nice-to-have, needs design.
- Long-press mobile drag.
- Registry-drive the medical/ecommerce verticals (retire hardcoded JSX) + fix their mobile density & mock data (DASH-06, DASH-07).
- Consume/deprecate `widget_config` admin allowlist (DASH-05).
- `saved-resources` and `tasks` widgets (blocked on data model — §8).

---

## 8. Product-owner questions

1. **Audience priority**: The client dashboard (currently zero customization) vs the staff dashboard (has `WidgetGrid` but empty data) — which gets the customizable engine first? (Recommendation: client.)
2. **`widget_config` semantics**: Keep the admin "widget visibility" allowlist (`profiles.widget_config`) as an enforced cap on the user's catalog, or deprecate it (it's currently write-only, DASH-05)?
3. **Vertical dashboards**: Are `dashboard-medical` / `dashboard-ecommerce` real product surfaces to make customizable, or demo/sales pages? The e-commerce one is 100% mock (DASH-07) and both are orphaned from `CLIENT_DASHBOARD_PATHS`.
4. **`tasks` and `saved-resources` widgets**: no backing data model exists today. Should these be in MVP (needs new tables/APIs) or deferred?
5. **Persistence shape**: dedicated `dashboard_layouts` table (recommended, `surface`-scoped, clean RLS) vs `profiles.preferences.dashboard` (no migration, reuses existing endpoint)?
6. **Resize scope**: is variable widget width (1/3 · 2/3 · full) an MVP expectation, or is fixed default-size + reorder enough for v1?
7. **Reset destructiveness**: should "Сбросить" wipe the user's layout entirely to role default, or offer "restore removed widgets" without discarding custom order?
