# AIStart360 — UI/UX, Mobile & Accessibility Audit

Date: 2026-07-07
Auditor scope: visual quality, UX flows, mobile experience, a11y across real components/pages.
ID prefix: `UX`. Severity ∈ Critical / High / Medium / Low.

This report separates **findings** (the observed problem, grounded in `file:line`) from
**recommendations** (the proposed change) and always states the **purpose** of each change.
No source code was modified — the only write is this report.

---

## 0. Method & coverage

Read and analysed:

- Design tokens: `app/globals.css`, `tailwind.config.ts`
- UI primitives: `components/ui/{Button,Input,Modal,Card,Toast,Badge}.tsx`
- Layout: `components/layout/{DashboardShell,Header,Sidebar,MobileNav,ExpertHeader}.tsx`, `app/(dashboard)/layout.tsx`, `app/client/layout.tsx`
- Auth: `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`
- Client flow: `app/client/point-a/page.tsx`, `app/client/point-b/page.tsx`, `app/client/onboarding/page.tsx`
- Dashboards: `app/(dashboard)/metrics/page.tsx` + `components/metrics/MetricsPageClient.tsx`, `components/dashboard/{KpiBlock,KpiCardsGrid}.tsx`, `components/gri/assessment/GRIAssessment.tsx`, `components/market/MarketAppEmbed.tsx`
- Settings/admin: `app/(dashboard)/settings/page.tsx` + `components/settings/SettingsClient.tsx`, `app/admin-giga-panel/page.tsx`
- States: `app/error.tsx`, `app/loading.tsx`, `app/not-found.tsx`

---

## 1. Findings table

| ID | Sev | Page/Component | Problem | Evidence | Recommended Improvement | Acceptance Criteria |
|----|-----|----------------|---------|----------|-------------------------|---------------------|
| UX-01 | Critical | Global inputs (all forms) | Text inputs use `text-sm` (14px). iOS Safari auto-zooms the viewport on focus of any `<input>`/`<textarea>` below 16px, producing a jarring zoom-jump on every field. | `components/ui/Input.tsx:36`; `components/settings/SettingsClient.tsx:881` (shared `Field`); `app/(auth)/register/page.tsx:182,193,204,215,231` | Set input font-size ≥16px on mobile (`text-base` or a `text-[16px] md:text-sm` pattern), or add `text-base` to the base `Input` and shared `Field`. Purpose: eliminate the involuntary viewport zoom that breaks every mobile form flow. | On iPhone Safari, focusing any text field does NOT trigger page zoom. Verified on login, register, settings, onboarding steps. |
| UX-02 | High | Client pages have no navigation shell | `app/client/*` pages (point-a, point-b, onboarding, welcome) render under `app/client/layout.tsx` which has NO Sidebar/Header/MobileNav — only the mascot. On mobile a client on `/client/point-a` has no bottom nav and can only move via a custom, overflowing header. | `app/client/layout.tsx:1-12` (no shell); `app/(dashboard)/layout.tsx:14-40` (full shell w/ MobileNav) | Give client pages a consistent bottom nav (reuse `MobileNav`) or a compact fixed nav so users can reach Метрики/GRI/Рынок from anywhere. Purpose: prevent dead-ends; the primary client landing page currently has the weakest mobile navigation of the whole app. | On mobile, `/client/point-a` and `/client/point-b` expose a bottom nav or menu reaching all permitted sections; no route is a nav dead-end. |
| UX-03 | High | `app/client/point-a/page.tsx` header | Sticky header packs 5 text buttons (Share, «Кабинет», «Пересчитать», «Документы», «Выход») in `flex flex-wrap gap-2`, each `px-3 py-1.5` (~28px tall, <44px). On mobile they wrap to 2–3 rows and consume most of the viewport top. | `app/client/point-a/page.tsx:265-298` | Collapse secondary actions into an overflow «•••» menu on mobile; keep only logo + one primary action inline. Raise tap height to ≥40px. Purpose: reclaim vertical space and hit tap-target minimums on the most-visited client screen. | On a 375px viewport the point-a header is a single row; secondary actions live in a menu; every actionable control is ≥40px tall. |
| UX-04 | High | `components/gri/assessment/GRIAssessment.tsx` | 1–10 rating uses `grid-cols-10`; on a ~320px content width each button is ~29px wide with `gap-1.5` — below the 44×44 tap minimum and error-prone with a thumb. Also uses raw `bg-red-500/bg-yellow-500/bg-emerald-500` instead of tokens. | `GRIAssessment.tsx:96-125` | On mobile switch to `grid-cols-5 grid-rows-2` (or a horizontally-scrollable row) so each cell is ≥44px; map tone colours to design tokens or documented status colours. Purpose: make the core diagnostic input reliably tappable and on-brand. | Each rating button is ≥44×44 on a 360px screen; colours come from tokens; no mis-taps in manual thumb testing. |
| UX-05 | High | `app/client/onboarding/page.tsx` step tabs | 12 step pills render in a `flex-wrap` sticky bar (`sticky top-[54px]`), wrapping to 4–5 rows on mobile and stacking below the top-0 header — two stacked sticky bars eat ~40% of a phone viewport before any form field. Pills are `py-1.5` (<44px). | `onboarding/page.tsx:300-328` (comment even says "wraps so ALL 12 stay visible") | On mobile use a single horizontally-scrollable step strip (`overflow-x-auto`, snap) with the active step auto-scrolled into view, OR a compact «Шаг N / 12» + prev/next; drop the second sticky layer. Purpose: keep the form itself above the fold on phones during a 12-step survey. | On a 667px-tall phone, at least the first form field is visible without scrolling; step nav is one row; tap targets ≥40px. |
| UX-06 | High | `components/market/MarketAppEmbed.tsx` iframe | Market SPA is embedded with `minHeight: 640` and `height: calc(100vh - 220px)`. The embedded Mark-analytics app is desktop-first; on a phone it forces a 640px-tall iframe of a desktop layout → horizontal scroll + pinch-zoom inside the iframe. | `MarketAppEmbed.tsx:321-333` | On small screens show a "лучше на десктопе / открыть в новой вкладке" affordance, or let the iframe shrink and rely on the SPA's own responsiveness; avoid forcing a fixed 640px min. Purpose: avoid trapping mobile users in a nested desktop viewport with two scroll axes. | On mobile, the market section either renders a mobile-appropriate view or offers an explicit external-open with no nested horizontal scroll. |
| UX-07 | Medium | `components/ui/Toast.tsx` | Toasts anchor at `bottom-6 right-4` and overlap the mobile bottom nav (`h-16` fixed, bottom-0) and the mascot FAB. Each toast also has `role="alert"` (assertive) inside an `aria-live="polite"` container — success toasts interrupt screen readers. | `Toast.tsx:11` (position); `Toast.tsx:53` (`role="alert"` per item) | Offset toasts above the bottom nav on mobile (`bottom-24 lg:bottom-6`); use `role="status"` for success/info and reserve `role="alert"` for errors. Purpose: keep confirmations visible and not covered; correct SR verbosity. | On mobile the toast never sits under the bottom nav/FAB; success toasts are announced politely, errors assertively. |
| UX-08 | Medium | `components/ui/Modal.tsx` | Modal has no focus trap and no initial-focus move; on open, keyboard focus stays on the trigger and Tab can leave the dialog into background content. No `aria-describedby` wired to `description`. Backdrop click closes but there is no restore-focus on close. | `Modal.tsx:47-99` | Add focus trap (move focus to the dialog on open, cycle Tab within, restore focus to trigger on close) and wire `aria-describedby`. Purpose: WCAG 2.4.3 / dialog-pattern compliance; keyboard users are currently able to interact with hidden background. | Opening the modal moves focus inside; Tab cycles within; ESC/close restores focus to the opener; SR reads title+description. |
| UX-09 | Medium | `components/ui/Button.tsx` size `icon` | `size: icon` = `p-2` → ~32×32px, below the 44px touch minimum. Used for icon-only actions across the app. | `Button.tsx:20` | Make `icon` ≥40px (`p-2.5` + `min-w/min-h`) or add an explicit `min-h-[44px] min-w-[44px]` on mobile. Purpose: reliable thumb targets for icon buttons. | All icon-only buttons render ≥40px (ideally 44px) on touch devices. |
| UX-10 | Medium | Main dashboard has no mobile menu button | The `(dashboard)` layout hides the Sidebar `< lg` and relies solely on `MobileNav`'s bottom bar (4 tabs + «Ещё» drawer). Unlike Expert/Owner headers there is no burger; the `Header` search+actions stay but full nav is only reachable via the bottom «Ещё» sheet. | `app/(dashboard)/layout.tsx:16-30`; `components/layout/Header.tsx` (no burger); cf. `ExpertHeader.tsx:24-28` (has burger) | This is acceptable IF the bottom «Ещё» sheet is discoverable, but the pattern is inconsistent with Expert/Owner. Consider unifying: either add a burger to the main Header or a drawer to Expert/Owner. Purpose: consistent mobile nav mental model across roles. | Mobile nav pattern is consistent across client/expert/owner; all sections reachable in ≤2 taps. |
| UX-11 | Medium | `components/layout/Header.tsx` search | Search `<input>` is `text-xs` (12px) → iOS zoom-on-focus (same class as UX-01); also the animated `w-32→w-56` width change on focus shifts the whole header layout. | `Header.tsx:198` (`text-xs`), `Header.tsx:174` (width animation) | Raise to ≥16px on mobile; make the focus-expand not reflow sibling actions (e.g. absolute-position the expanded field or expand into reserved space). Purpose: no zoom, no layout jump when focusing search. | Focusing header search causes no zoom and no reflow of the right-hand action cluster. |
| UX-12 | Medium | `components/metrics/MetricsPageClient.tsx` tab switcher | Tab pills use `w-fit flex-wrap` inside a rounded container; on narrow screens the 4 tabs wrap to 2 rows inside the pill, breaking the segmented-control visual and leaving an awkward half-filled second row. | `MetricsPageClient.tsx:682-699` | Use a single horizontally-scrollable segmented control (`overflow-x-auto no-scrollbar`, `whitespace-nowrap`) on mobile instead of wrapping. Purpose: preserve the segmented-control affordance and keep all tabs on one predictable line. | On a 360px screen the metrics tabs are one scrollable row, not a wrapped 2-row pill. |
| UX-13 | Medium | Design-system: font config drift | `tailwind.config.ts` `fontFamily` maps `headline→Space Grotesk`, `body→Inter`, `label→DM Sans`, whereas `globals.css` `--font-*` and the `.font-*` utilities map to `Bricolage Grotesque / DM Sans / Space Grotesk / JetBrains Mono`. Two sources of truth for the type system; whichever wins depends on class vs. token usage. | `tailwind.config.ts:75-80` vs `app/globals.css:8-11,160-163` | Make the Tailwind `fontFamily` reference the same CSS vars as globals (`var(--font-headline)` etc. are declared but the fallback stacks disagree). Purpose: guarantee `font-headline` (Tailwind) and `.font-headline` (utility) render the same face. | `font-headline` via Tailwind and `.font-headline` utility produce identical fonts; one documented source of truth. |
| UX-14 | Medium | Color-token drift (raw hex backgrounds) | Auth and several surfaces use `bg-[#0a0e17]` / `bg-[#0c0e14]` / `bg-[#0e0f14]` / `bg-[#111318]` / `bg-[#13151c]` instead of the documented background `#0A0B0F` / `surface-*` tokens. 30+ occurrences. | `app/(auth)/login/page.tsx:105,282`; `app/(auth)/register/page.tsx:81,240`; `app/client/onboarding/page.tsx:256,258`; `components/layout/{Sidebar,MobileNav,ExpertHeader}.tsx` | Consolidate to the token palette (`bg-background`, `bg-surface-container-*`). Purpose: single dark-surface scale; avoids subtle mismatches between login (`#0a0e17`, slightly blue) and the app background (`#0A0B0F`). | No page uses a one-off dark hex; all backgrounds resolve to a named token. |
| UX-15 | Medium | `components/gri/assessment/GRIAssessment.tsx` + GRI calc | Uses emoji status labels («✅ Сильная зона», «⚠️ Зона риска», «🚨 Критическая зона») and raw Tailwind status colors (`text-emerald-300`, `bg-red-500/10`). Inconsistent with the token system (`text-primary`, `text-error`) and emoji render inconsistently across platforms. | `GRIAssessment.tsx:130-139` (emoji + raw colors) | Replace emoji with Material Symbols + token colors (`text-primary` / `text-tertiary` / `text-error`). Purpose: consistent, platform-independent status semantics and brand colors. | Status zones use icon + token color, no emoji; contrast passes AA. |
| UX-16 | Low | `components/dashboard/KpiBlock.tsx` | KPI card is `cursor-default` with a hover-only affordance (`hover:border-primary/40`, value turns teal on hover). On touch there is no hover, so the interactive-looking treatment misleads; and if the card is meant to open a drill-down it lacks a button role. | `KpiBlock.tsx:11,20` | If clickable → make it a real `<button>` with focus ring and aria-label; if purely display → drop the hover-highlight that implies interactivity. Purpose: honest affordances on touch where hover doesn't exist. | KPI cards either are keyboard-focusable buttons or have no interactive-looking hover; behavior matches on touch. |
| UX-17 | Low | `components/ui/Input.tsx` label casing | Labels forced `uppercase tracking-wider` at `text-xs`. Uppercased Cyrillic at 12px with wide tracking reduces readability for Russian copy (Cyrillic has taller x-height; all-caps hurts scanning). | `Input.tsx:21` | Keep the mono-caps treatment for tags/captions per the design language, but allow form field labels to be sentence-case for readability, or bump size. Purpose: legibility of Russian form labels. | Form labels remain legible; caps-tag style reserved for captions/tags per spec. |
| UX-18 | Low | `components/layout/ExpertHeader.tsx` | Notification button and avatar cluster controls are `w-9 h-9` (36px) and the inline logout icon (`ml-1`, base icon) is <44px. | `ExpertHeader.tsx:37,50` | Bump icon controls to ≥40px on touch. Purpose: tap-target compliance in the expert portal header. | Expert header icon controls ≥40px on mobile. |
| UX-19 | Low | `app/(auth)/register/page.tsx` role tabs / social | Role tabs are `h-10` (40px, OK) but disabled LinkedIn buttons look identical to enabled Google except opacity; disabled state relies only on lowered opacity + `cursor-not-allowed` (no text cue). | `register/page.tsx:255-261` | Add a visible "скоро" label to disabled social buttons (Google is enabled). Purpose: communicate unavailability without relying on hover/cursor. | Disabled social buttons carry a visible "скоро/недоступно" cue. |
| UX-20 | Low | `components/ui/Toast.tsx` auto-dismiss | Fixed 5s auto-dismiss with no pause-on-hover/focus and no way to keep long error messages on screen; a11y users may not finish reading. | `Toast.tsx:39-42` | Pause the timer on hover/focus; consider not auto-dismissing errors. Purpose: give slower readers / SR users time. | Hovering/focusing a toast pauses dismissal; error toasts persist until dismissed. |

---

## 2. Screen-by-screen UX notes

### 2.1 Auth — login (`app/(auth)/login/page.tsx`)
- **Good:** strong split-layout, branded left panel hidden `< lg`, demo-access is prominent, password show/hide has `aria-label`, error banner is dismissible with `aria-label`.
- **Issues:** background `bg-[#0a0e17]` (UX-14, slightly blue vs app `#0A0B0F`). Inputs are `h-12` with default (inherited 16px) font — good, no zoom here, but this is inconsistent with register/settings which use `text-sm`. The left-panel stat pills and testimonial are decorative and correctly dropped on mobile.
- **Mobile:** single-column form, `max-w-md`, `p-6` — clean. Social buttons `grid-cols-2 gap-3`, `h-11` — OK.

### 2.2 Auth — register (`app/(auth)/register/page.tsx`)
- **Issues:** all inputs `text-sm` → iOS zoom (UX-01). Inputs `h-11` (44px, borderline OK). Terms checkbox is `w-4 h-4` with a large tappable `<label>` wrapper — acceptable. Disabled LinkedIn button ambiguity (UX-19). Background `#0a0e17` (UX-14).
- **Good:** role tabs are a clear segmented control; the "заявка на рассмотрении" info card sets expectations well.

### 2.3 Client — Point A (`app/client/point-a/page.tsx`)
- **Biggest client screen; standalone layout with no shell (UX-02).**
- Sticky header button overflow (UX-03). Header + main both `px-6` with no mobile reduction — content is edge-tight on small phones; recommend `px-4 md:px-6`.
- **Good:** hero uses `flex-col md:flex-row`, ScoreGauge centered on mobile, meta chips `flex-wrap`. Empty state ("Диагностика не рассчитана") is well-designed with clear CTAs. Loading spinner state present.

### 2.4 Client — Point B (`app/client/point-b/page.tsx`)
- Same standalone-header pattern; 4 header controls `flex gap-3` (no wrap declared) — on a 360px screen ShareButton + 2 links + logout will overflow horizontally (no `flex-wrap`, could clip). `max-w-5xl px-6`.
- Recommend the same overflow-menu treatment as UX-03.

### 2.5 Client — Onboarding (`app/client/onboarding/page.tsx`)
- **Two stacked sticky bars + 12 wrapping step pills (UX-05)** is the dominant mobile problem.
- **Good:** progress bar under header, per-step hint card, non-blocking inline validation, "early exit / сформировать Точку А" is a thoughtful UX escape hatch, generous nav buttons (`py-3`). Background `#0c0e14` (UX-14).

### 2.6 Dashboard — Metrics (`components/metrics/MetricsPageClient.tsx`)
- Tab switcher wrap issue (UX-12). Uses a second `sticky top-0` internal header (`:436`) in addition to the app Header — double sticky on desktop is fine but stacks on mobile.
- **Good:** KPI grids are responsive (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`), good `EmptyState` usage, realtime-synced. `MetricModal` lazy-loads recharts (perf-conscious).

### 2.7 Dashboard — Market (`components/market/MarketAppEmbed.tsx`)
- iframe min-height trap on mobile (UX-06). Honest "продукт недоступен" down-state is excellent. Tab bar `flex-wrap gap-2` with `aria-pressed` — good a11y, but wraps on mobile.

### 2.8 GRI (`components/gri/assessment/GRIAssessment.tsx`)
- 10-across rating tap targets (UX-04) and emoji/raw-color status (UX-15). Otherwise the assessment structure (sections, section averages, loss-aversion bars) is clear.

### 2.9 Settings (`components/settings/SettingsClient.tsx`)
- Shared `Field` uses `text-sm` inputs (UX-01). 2FA flow inputs use `text-lg` (no zoom) — good. Save/cancel buttons `py-2` (~36px) — slightly under 44px on mobile. "Есть несохранённые изменения" indicator is a nice touch.

### 2.10 Admin — Giga Panel (`app/admin-giga-panel/page.tsx`)
- Correctly uses the **blue** theme (`text-blue-400`, `bg-blue-500/*`, `logo-icon-blue.svg`) per the design language exception, and lucide icons are acceptable here. Confirmed separation from the teal client portal is respected. (Not deeply audited for mobile per scope priority; flag for a dedicated admin pass.)

### 2.11 Global states
- `app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx` are all branded, dark, Russian, with clear recovery CTAs — **strong**. No changes needed.

---

## 3. Mobile-first priorities (top 10, ordered)

1. **UX-01** — Kill iOS input zoom (≥16px font on all text inputs). Affects every form; single highest-impact fix.
2. **UX-02** — Give `app/client/*` pages a real mobile nav (no dead-ends on the primary client landing).
3. **UX-05** — Fix the 12-step onboarding step strip (single scrollable row, drop double-sticky) so the form is above the fold.
4. **UX-03** — Collapse Point A header actions into an overflow menu; hit tap-target sizes.
5. **UX-04** — GRI 1–10 rating to 5×2 / scrollable ≥44px targets.
6. **UX-06** — Market iframe: stop forcing 640px desktop viewport on phones.
7. **UX-07** — Move toasts above the bottom nav/FAB on mobile; fix `role=alert` verbosity.
8. **UX-12** — Metrics tab strip: scroll, don't wrap.
9. **UX-09 / UX-18** — Raise icon-button and header-control tap targets to ≥40px.
10. **UX-11** — Header search: no zoom, no reflow on focus.

---

## 4. Design-system notes

- **Two type-system sources of truth** (UX-13): reconcile `tailwind.config.ts` `fontFamily` with `globals.css` `--font-*` / `.font-*` utilities.
- **Raw dark-hex proliferation** (UX-14): 30+ one-off `bg-[#0x0x0x]` values; several are near-`#0A0B0F` but slightly blue (`#0a0e17`). Consolidate to `bg-background` / `surface-*`.
- **Raw status colors + emoji** (UX-15): GRI/GRI-calc bypass tokens (`bg-red-500`, `text-emerald-300`) and use emoji for state. Map to `primary` / `tertiary` / `error` tokens + Material Symbols.
- **Token color naming** is otherwise well-structured (`on-surface`, `on-surface-variant`, `surface-container-*` ladder). `text-error` is correctly used for negative trends; `text-primary` for positive.
- **`prefers-reduced-motion`** is respected globally (`globals.css:35-44`) and `:focus-visible` rings are implemented app-wide (`globals.css:49-53`) — strong a11y baseline. Keyframe animations are lightweight (no heavy parallax/scroll-jank observed); no motion cuts recommended beyond honoring existing reduced-motion.
- **Tap-target CSS tuning** (`globals.css:87-99`) sets `touch-action: manipulation` globally — good; but per-component sizes still fall short in several icon buttons.
- **Custom scrollbar** is 4px — thin but acceptable on desktop; fine on mobile (native).

---

## 5. Product-owner questions

1. **Client layout shell:** Should `app/client/*` (point-a, point-b, onboarding) adopt the shared `MobileNav`/Header, or is the intentional "focused, chrome-less" flow desired? (Drives UX-02/03 scope.)
2. **Market on mobile:** Is the Mark-analytics embed expected to work on phones at all, or should mobile users get an "открыть на десктопе" gate? (Drives UX-06.)
3. **Onboarding step nav:** Preference between (a) horizontally-scrollable step strip vs (b) compact "Шаг N/12 + prev/next" on mobile? (Drives UX-05.)
4. **KPI cards:** Are `KpiBlock` cards meant to be clickable drill-downs? If so they need button semantics; if not, drop the hover-interactive styling. (Drives UX-16.)
5. **Font system:** Which is the intended headline face — Bricolage Grotesque (globals) or Space Grotesk (Tailwind fallback)? (Drives UX-13.)
6. **Toast placement:** OK to offset toasts to `bottom-24` on mobile so they clear the bottom nav, or is another anchor (top) preferred? (Drives UX-07.)
