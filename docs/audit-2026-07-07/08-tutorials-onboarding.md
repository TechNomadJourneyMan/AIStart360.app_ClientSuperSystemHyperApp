# 08 — Tutorials & Onboarding Audit + Expansion Spec

**Auditor:** Tutorials & Onboarding
**Date:** 2026-07-07
**Scope:** the real onboarding/tutorial/coachmark system, page-by-page coverage of all 81 routes, display/mobile bugs, skip/replay/progress logic, and a full expansion spec.
**ID prefix:** TUT.
**Rule:** read-only audit; the only file written is this report.

---

## 1. Summary

AIStart360 has exactly **one** genuine in-product tutorial system: the **coachmark tour engine** bolted onto the mascot assistant «Гри» (`lib/assistant/mascot/tours.ts` + `components/assistant/mascot/MascotCoachmarks.tsx`, orchestrated by `MascotAssistant.tsx`). It is a spotlight-overlay walkthrough that highlights real DOM elements by CSS selector, shows a mascot card with an arrow, and persists completion per-screen in `profiles.preferences.assistant.toursDone` (JSONB). It is well-built: resilient (missing-selector steps are skipped), has skip/back/next/progress-dots, Esc handling, keyboard nav, replay via settings and a `«Подсказки по странице»` menu item, and a `«Сбросить обучение»` reset. Separately there is a **FirstRunWizard** (a static "3 шага до GRI" card on `/dashboard`) and a **12-step survey** (`/client/onboarding`) — neither is a tutorial, they are task flows. The system has three material gaps: **(1) coverage** — tours are defined for only ~11 screens and the mascot is mounted in only 2 of 5 route groups, so owner/expert/admin/auth/public surfaces (30+ pages) have zero onboarding; **(2) mobile display** — the coachmark card is a fixed 330px width that overflows/crowds sub-360px viewports, and the mascot hides itself entirely when the on-screen keyboard is open, breaking survey tours on phones; **(3) fragile anchors** — several tours target `h1`, but `/gri` and `/client/dashboard` render no `<h1>`, so those tours silently degrade to a single mascot step or nothing. The assistant «Гри» chat has **no** "покажи туториал этой страницы" intent wired at all — the requested integration does not exist.

---

## 2. Current system map

### 2.1 Files that ARE the tutorial/onboarding system

| File | Role |
|---|---|
| `lib/assistant/mascot/tours.ts` | **Tour content** — `TOURS: Record<screen, TourStep[]>`. 11 screens defined. Each step = `{selector, title, text}`. Shared `MASCOT_STEP` closes every tour. `tourForScreen(screen)`. |
| `components/assistant/mascot/MascotCoachmarks.tsx` | **Tour renderer** — dimmed overlay + spotlight cut-out around the target, mascot card + arrow. Skip/Back/Next/Готово, progress dots, Esc + arrow keys, `scrollIntoView`, re-measure on scroll/resize. |
| `components/assistant/mascot/MascotAssistant.tsx` | **Orchestrator** — decides when a tour auto-runs (first visit per screen), persists `toursDone`, listens for the `aistart:tutorial:replay` event, exposes `onPageTour` (menu "Подсказки по странице"). |
| `components/assistant/mascot/MascotControls.tsx` | `«Подсказки по странице»` menu item (`onPageTour`) — manual replay of the current screen's tour. |
| `lib/assistant/mascot/hints.ts` | Scripted proactive **bubbles** (greeting, idle_help, complex_section education, celebrate_progress, next_step…) + `SCREEN_TIPS` (per-screen one-liners shown in the chat panel header). NOT coachmarks, but adjacent onboarding nudges. |
| `lib/assistant/mascot/types.ts` | `MascotSettings.toursDone: string[]`, legacy `tutorialDone: boolean`, `DEFAULT_MASCOT_SETTINGS`. |
| `lib/assistant/mascot/settings-server.ts` | Read/merge/write `profiles.preferences.assistant` (RLS, session-scoped, IDOR-safe). `normalizeMascotSettings` coerces `toursDone` (max 50). |
| `app/api/v1/assistant/settings/route.ts` | GET/PATCH the settings bag; `toursDone` whitelisted in the Zod schema (`z.array(z.string().max(64)).max(50)`). |
| `components/settings/AssistantSettingsPanel.tsx` | `«Сбросить обучение»` button → `patch({toursDone: []})` + dispatches `aistart:tutorial:replay`. Reachable via Settings → tab «Ассистент» (`SettingsClient.tsx`). |
| `components/dashboard/FirstRunWizard.tsx` | Static "3 шага до GRI" card (server component). Steps: анкета → документы → GRI, with real per-step completion. Rendered only on `/dashboard`. `data-first-run-wizard` suppresses the mascot greeting while present. |

### 2.2 What EXISTS (behaviour)

- **Auto-run:** on first visit to a screen that has a tour, after a 1200ms delay, if `toursDone` doesn't include it and it hasn't run this session (`tourSessionRef`). `MascotAssistant.tsx:560-572`.
- **Completion persistence:** finishing OR skipping writes `screen` into `toursDone` (server PATCH). `MascotAssistant.tsx:592-606`, `closeTour`.
- **Skip / Back / Next / progress dots / Esc / arrow keys:** all present. `MascotCoachmarks.tsx:97-106,183-214`.
- **Replay (global):** Settings → Ассистент → «Сбросить обучение» clears `toursDone` and re-fires. `AssistantSettingsPanel.tsx:298-307`.
- **Replay (per page):** mascot «⋯» menu → «Подсказки по странице». `MascotAssistant.tsx:585-590`, `MascotControls.tsx:80-84`.
- **"Don't show again":** implicit — a completed/skipped tour never re-runs (stored in `toursDone`). No explicit toggle, but the reset covers replay.
- **Resilience:** a step whose selector matches nothing is filtered out (`liveSteps`), so tours survive page changes. If ZERO steps match, the tour closes immediately without marking done (`MascotCoachmarks.tsx:59-61` calls `finish(false)` → still marks screen done via `closeTour`). ⚠️ see TUT-05.

### 2.3 Persistence model

- **Single source of truth:** `profiles.preferences.assistant` JSONB bag (migration-035 convention). Keys: `toursDone: string[]` (per-screen), `tutorialDone: boolean` (legacy v1.3 modal, unused by coachmarks), `greeted: boolean`, `dismissedHints`, `behavior`, `character`, `color`, hide state.
- **NOT localStorage** for tours (good — cross-device). One `sessionStorage` key exists: `aistart_gree_welcomed` (welcome-back bubble, per browser session). `MascotAssistant.tsx:229-231`.
- **Survey progress** is separate (`/api/v1/onboarding/status`, `progress.completedSections`), surfaced to the mascot via `/api/v1/assistant/context`.

### 2.4 Mount points (defines coverage ceiling)

`MascotLauncher` (which lazy-loads `MascotAssistant`, incl. tours) is mounted in **only two** layouts:
- `app/(dashboard)/layout.tsx:35`
- `app/client/layout.tsx:9`

It is **absent** from `app/(owner)/layout.tsx`, `app/(expert)/layout.tsx`, and there is no root-layout mount. Kill switch: `NEXT_PUBLIC_FEATURE_MASCOT='0'` → static launcher, no tours.

---

## 3. Coverage map — all 81 routes

Legend: **Tour** = has an entry in `TOURS`. **Mascot** = mascot/tour engine mounted for this route group. **Wizard** = FirstRunWizard shown.

### 3.1 `(dashboard)` group — mascot MOUNTED

| Route | Tour? | Notes / Gaps |
|---|---|---|
| `/dashboard` | ✅ 3 steps + mascot | Anchors `#key-metrics`/`#company-data`/`#market-analysis` all exist (verified). FirstRunWizard also here. Best-covered page. |
| `/gri` | ⚠️ tour defined, anchor `h1` MISSING | `/gri` renders GRICalculator/GRIAssessment — **no `<h1>`**. Tour degrades to mascot-only or empty. TUT-05. |
| `/pulse` | ⚠️ `h1` | Heading likely in child; verify. |
| `/point-a` | ✅ (`h1` present) | OK. |
| `/point-b` | ✅ (`h1` in PointBView) | OK. |
| `/metrics` | ✅ (`h1` in MetricsPageClient) | OK. |
| `/market` | ✅ (`main button[aria-pressed]`) | Fragile selector — depends on tab bar rendering. |
| `/insights` | ❌ | No tour. AI-insights page — high value, uncovered. |
| `/analytics` | ❌ | No tour. |
| `/competitors` | ❌ | No tour. |
| `/intelligence` | ❌ | No tour. |
| `/reports` | ❌ | No tour. |
| `/clients`, `/clients/[id]`, `/clients/[id]/point-b` | ❌ | Expert/consultant surface — no tour. |
| `/activity` | ❌ | No tour. |
| `/admin`, `/admin/requests` | ❌ | No tour. |
| `/ai-scanner` | ❌ | No tour. |
| `/notifications` | ❌ | No tour. |
| `/profile` | ❌ | No tour. |
| `/settings` | ❌ | No tour (but hosts the reset control). |
| `/team` | ❌ | No tour. |
| `/users` | ❌ | No tour. |
| `/market/analysis` | ❌ | No tour. |
| `/point-a/insights` | ❌ | No tour. |

### 3.2 `client/*` group — mascot MOUNTED

| Route | Tour? | Notes / Gaps |
|---|---|---|
| `/client/dashboard` | ⚠️ tour defined, anchor `h1` MISSING | No `<h1>` in page or `components/client|dashboard`. Degrades to mascot-only. TUT-05. |
| `/client/onboarding` | ✅ (`h1` present) + education bubble | Survey. Also `complex_section` education nudge. But mobile keyboard hides mascot → TUT-02. |
| `/client/onboarding/documents` | ❌ | Normalizes to `/client/onboarding` (2-seg) so it INHERITS that tour's anchor — but the doc page has different UI. Mislabeled coverage. TUT-06. |
| `/client/point-a` | ✅ (`h1` present) | OK. |
| `/client/point-b` | ✅ | OK. |
| `/client/welcome` | ❌ | Entry/vertical-picker page — **no tour**, first thing a new user sees. High-value gap. |
| `/client/waiting-room` | ❌ | Post-registration holding page — no tour. |
| `/client/my-data` | ❌ | No tour. |
| `/client/scenarios` | ❌ | No tour. |
| `/client/dashboard-ecommerce` | ❌ | Vertical variant — no tour. |
| `/client/dashboard-medical` | ❌ | Vertical variant — no tour. |
| `/client/onboarding-ecommerce` | ❌ | Vertical survey — no tour. |
| `/client/onboarding-medical` | ❌ | Vertical survey — no tour. |

### 3.3 `(owner)` group — mascot NOT mounted → ZERO tutorials

`/owner/dashboard`, `/owner/admin`, `/owner/analytics`, `/owner/clients`, `/owner/clients/[id]`, `/owner/competitors`, `/owner/gri`, `/owner/insights`, `/owner/intelligence`, `/owner/market`, `/owner/metrics`, `/owner/notifications`, `/owner/point-a`, `/owner/point-b`, `/owner/profile`, `/owner/reports`, `/owner/settings`, `/owner/team`, `/owner/users` — **all ❌** (19 pages). TUT-01.

### 3.4 `(expert)` group — mascot NOT mounted → ZERO tutorials

`/expert/dashboard`, `/expert/clients`, `/expert/clients/[id]`, `/expert/gri`, `/expert/insights`, `/expert/profile`, `/expert/reports` — **all ❌** (7 pages). TUT-01.

### 3.5 Auth / public / standalone — no mascot, mostly acceptable

`/(auth)/login|register|forgot-password`, `/auth/reset-password`, `/(public)/gri-free|privacy|terms`, `/2fa`, `/admin-giga-panel`, `/giga-login`, `/checkout/{stub,success,cancel}`, `/presentation`, `/r/[token]` — no tutorials. Auth/legal/checkout are fine without; **`/gri-free`** (public free mini-GRI funnel) and **`/admin-giga-panel`** (complex admin) are arguable gaps. TUT-08.

**Coverage totals:** ~7 pages with a *working* tour, ~4 with a *defined-but-degraded* tour, **~70 pages with no tutorial**. Of those 70, ~26 (owner+expert) cannot have one without a mount fix.

---

## 4. Findings

| ID | Sev | Page/Feature | Issue | Evidence (file:line) | Fix | Acceptance Criteria |
|---|---|---|---|---|---|---|
| TUT-01 | High | owner + expert route groups (26 pages) | Mascot/tour engine is not mounted in `(owner)` or `(expert)` layouts, so those roles get **no onboarding at all** — no tours, no proactive hints, no assistant launcher fallback tours. | `components/assistant/mascot/MascotLauncher.tsx:44-52` mounted only at `app/(dashboard)/layout.tsx:35` & `app/client/layout.tsx:9`; `app/(owner)/layout.tsx:1-13` and `app/(expert)/layout.tsx:1-12` have no `MascotLauncher`. | Mount `MascotLauncher` in both group layouts; add tours for `/owner/dashboard`, `/expert/dashboard`, `/owner/clients`, `/expert/clients`. Gate hint copy by role. | Landing on `/owner/dashboard` or `/expert/dashboard` as a fresh user auto-runs a role-appropriate tour once; `toursDone` records the screen; no console error. |
| TUT-02 | High | `/client/onboarding` (survey) on mobile | The mascot sets `visibility:hidden` whenever the on-screen keyboard is open (`keyboardOpen`), and the tour's `busy` flag includes typing. On a phone the survey is a form → keyboard is up most of the time → the survey coachmark/education never shows, and the mascot vanishes mid-tour. | `MascotAssistant.tsx:156` `useSafeScreenPosition`; `:677` `visibility: keyboardOpen ? 'hidden' : 'visible'`; coachmark overlay is separate (`z-[70]`) but the *card* references the mascot avatar only. Tour auto-run gate `:560-572` doesn't run while a field is focused (`evaluate` blocks on `isTypingTarget`). | Allow the coachmark overlay to render independent of keyboard state; on mobile, blur active input before starting a survey tour; pin the card to viewport bottom-safe-area instead of near the avatar. | On a 375px viewport with a focused input, starting the `/client/onboarding` tour shows the card fully on-screen and does not disappear when the keyboard toggles. |
| TUT-03 | High | `MascotCoachmarks` card on mobile | Card width is a hard-coded `CARD_W = 330`. Clamp `Math.max(12, vw - CARD_W - 12)` yields left=33 on a 375px screen (12px right gutter) and **negative/degenerate** layout below ~354px (e.g. 320px iPhone SE) — card overflows the viewport, arrow math breaks. No responsive/compact variant (unlike `MascotBubble` which takes `compact`). | `MascotCoachmarks.tsx:19` `const CARD_W = 330`; `:123-124` clamp; `:156` `width: CARD_W`. Contrast `MascotBubble` usage `MascotAssistant.tsx:711` `compact={!isDesktop}`. | Make width responsive: `Math.min(330, vw - 24)`; add mobile layout that docks the card full-width at the bottom with the spotlight above; recompute `arrowLeft` against actual width. | At 320/375px, the card fits within the viewport with ≥12px gutters both sides; arrow points at the target; no horizontal scroll. |
| TUT-05 | High | `/gri`, `/client/dashboard` tours | Tours anchor step 1 to `h1`, but these routes render **no `<h1>`** anywhere in their tree, so the informative step is silently dropped — the tour becomes mascot-step-only (or, if the mascot button selector also misses, an empty tour that still marks the screen `done`, permanently suppressing it). | `tours.ts:45-52` (`/client/dashboard` → `h1`), `:61-68` (`/gri` → `h1`); `grep <h1` empty for `app/(dashboard)/gri/page.tsx` + `components/gri/**` and `app/client/dashboard/page.tsx` + `components/client|dashboard/**`. `MascotCoachmarks.tsx:59-61` empty tour → `finish(false)` → `closeTour` still writes `toursDone`. | Anchor to a stable existing element (e.g. `#gri-index`, a data-testid, or the calculator card) not `h1`; and in `closeTour`, do NOT mark `toursDone` when `liveSteps.length===0` so an unanchored tour can retry after the page renders content. | On `/gri` the tour shows at least one real content step highlighting the GRI index; an empty tour does not write `toursDone`. |
| TUT-06 | Medium | `/client/onboarding/documents` | Screen normalization collapses `/client/onboarding/documents` → `/client/onboarding` (first 2 segments), so the documents page runs the **survey** tour whose copy ("Анкета — 12 разделов") and `h1` anchor don't match the documents UI. Misleading tour + marks the survey screen done from the wrong page. | `hints.ts:68-72` `normalizeScreen` slices to 2 segments; `tours.ts:53-60` keyed `/client/onboarding`; documents page is `app/client/onboarding/documents/page.tsx`. | Either add a dedicated `/client/onboarding/documents` tour and normalize to 3 segments for onboarding, or exclude the documents subpath from the survey tour. | Visiting the documents page runs a documents-specific tour (or none), never the survey tour; survey `toursDone` is not set from the documents page. |
| TUT-07 | Medium | Assistant «Гри» chat | The requested "Покажи туториал этой страницы" integration **does not exist**. The chat panel has no intent/parser and no button that triggers `onPageTour`/`tourForScreen`. Users can only replay via the «⋯» menu (discoverable only by right-click/menu) or Settings. | No matches for tour/туториал in `components/assistant/AssistantChatPanel.tsx`; `onPageTour` wired only to `MascotControls.tsx:80-84`. | Add a chat quick-action + intent: when the user asks to show the tour (or a "Показать подсказки страницы" chip), dispatch a tour start for `normalizeScreen(currentScreen)`; expose `tourForScreen` availability in the panel. | Typing/clicking "покажи туториал этой страницы" in Гри starts the current page's coachmark tour; if none exists, Гри replies that this page has no tour yet. |
| TUT-09 | Medium | `/client/welcome`, `/client/waiting-room` | The two earliest post-registration screens (vertical picker + approval waiting room) have no tour and no proactive orientation, despite being the literal first-run entry. New users hit an unguided screen before the mascot greeting fires. | `app/client/welcome/page.tsx` (no tour key in `tours.ts`); `app/client/waiting-room/page.tsx` (no tour key). Greeting bubble is suppressed near FirstRunWizard but that wizard is on `/dashboard`, not here. | Add short welcome/waiting tours or a first-run explainer; ensure the greeting bubble can fire on `/client/welcome`. | First visit to `/client/welcome` shows a greeting/tour explaining vertical selection and next steps. |
| TUT-10 | Medium | `/market` tour selector | Tour anchors to `main button[aria-pressed]` — a generic selector that breaks if the tab bar markup changes or hasn't hydrated, and could match an unrelated toggle. | `tours.ts:117-124`. | Anchor to a stable `id`/`data-testid` on the market tab strip. | The `/market` tour reliably highlights the tab strip across renders. |
| TUT-11 | Low | Legacy `tutorialDone` flag | `MascotSettings.tutorialDone` (v1.3 modal tutorial) is still stored, validated, and PATCH-whitelisted but has **no reader** — dead surface that can confuse future work and bloats the settings contract. | `types.ts:59-60,80-81`; `settings-server.ts` normalizes it; `settings/route.ts:41` whitelists it; no consumer. | Deprecate/remove after confirming no external writers; keep read-normalization for back-compat only. | `tutorialDone` is removed from the PATCH schema and types, or documented as read-only legacy. |
| TUT-12 | Low | Coachmark overlay a11y (mobile) | Overlay is `role="dialog" aria-modal="true"` but has no focus trap and no visible close affordance besides text buttons; on touch there's no tap-outside-to-dismiss (tap on dim area does nothing). | `MascotCoachmarks.tsx:128` overlay; only `Пропустить`/keyboard Esc dismiss. | Add tap-on-scrim to skip, move focus into the card on open, trap focus, restore on close. | Tapping the dimmed area skips the tour; focus is trapped within the card; screen-reader announces the step. |
| TUT-13 | Low | No progress across a multi-page journey | Tours are per-screen and independent; there is no "onboarding journey" that chains screens (welcome → survey → docs → GRI) with a resumable overall %. FirstRunWizard is the only cross-page progress and it's a static card, not linked to the tour engine. | `FirstRunWizard.tsx` (static, `/dashboard` only); `tours.ts` (per-screen `TOURS`). | Introduce an optional ordered journey (see spec §5.3) that resumes where the user left off and reflects in the wizard. | A new user is walked screen-to-screen with a persistent journey progress indicator; leaving and returning resumes the journey. |

*(No Critical: the system is functional and safe; the gaps are coverage/mobile/UX, not breakage or security.)*

---

## 5. TUTORIAL EXPANSION SPEC

### 5.0 Design principles
- **One engine.** Keep the coachmark engine (`MascotCoachmarks` + `tours.ts`); do not introduce a second tutorial library. All new tutorials are `TourStep[]` entries.
- **Anchor by `data-tour` attributes**, not `h1`/generic selectors. Add `data-tour="<id>"` to real elements; tours reference `[data-tour="gri-index"]`. Removes TUT-05/TUT-10 fragility class-wide.
- **Role-aware copy.** Same engine, role-scoped `TOURS` maps (client vs owner vs expert).
- **Russian, mascot-voiced**, short (≤2 sentences/step, ≤4 steps/tour + mascot step).

### 5.1 Content structure & data model

- **Where content lives:** `lib/assistant/mascot/tours.ts` (extend). For scale, split into `tours/client.ts`, `tours/owner.ts`, `tours/expert.ts`, re-exported by screen key. Optionally allow a server-provided override in `profiles.preferences.assistant` is NOT recommended (copy shouldn't ship twice / per user); keep tours static in code, matching the existing hint-catalog pattern (`hints.ts`).
- **Step shape (extended):**
  ```ts
  interface TourStep {
    selector: string            // prefer [data-tour="…"]
    title: string
    text: string
    mobileText?: string         // shorter copy for phones
    placement?: 'auto'|'bottom'|'top'|'sheet'  // 'sheet' = mobile bottom dock
    completeOn?: 'next'|'click-target'|'route-change' // advance condition
  }
  ```
- **Editing:** engineers edit `tours.ts`. No CMS. A lightweight JSON schema + a unit test that every `selector` referenced has a matching `data-tour` in the codebase (grep test) prevents anchor rot.
- **Persistence:** unchanged — `toursDone: string[]` keyed by normalized screen. Add `journeyStep?: number` to settings for §5.3.

### 5.2 Per-page tutorial plan (new + fixed)

For each: **trigger** (auto first-visit unless noted) · **users** · **steps → highlighted element** · **RU step text** · **mobile** · **completion** · **replay**.

1. **`/client/welcome`** *(NEW, TUT-09)* — trigger: first visit; users: new client. Steps: (1) `[data-tour=vertical-picker]` «Выберите профиль бизнеса — так я настрою анкету под вас.»; (2) `[data-tour=start-cta]` «Отсюда начнём диагностику — это 10–15 минут.»; + mascot. Mobile: sheet placement. Complete: reach step end or navigate to onboarding. Replay: «⋯»/chat.
2. **`/client/waiting-room`** *(NEW)* — trigger: first visit while `status=pending`. Steps: (1) `[data-tour=status-card]` «Заявка на модерации — обычно это недолго.»; (2) `[data-tour=prefill-actions]` «Пока ждёте — заполните анкету и загрузите файлы, я всё сохраню.»; + mascot. Mobile: sheet. Complete/replay: standard.
3. **`/client/onboarding`** *(FIX TUT-02)* — trigger: first visit; blur input before start. Steps: (1) `[data-tour=section-nav]` «12 разделов — можно заполнять в любом порядке.»; (2) `[data-tour=save-indicator]` «Всё сохраняется автоматически.»; (3) education «Приблизительные цифры лучше пустых полей.»; + mascot. Mobile: sheet docked bottom, survives keyboard.
4. **`/client/onboarding/documents`** *(FIX TUT-06, NEW key)* — trigger: first visit (normalize 3-seg). Steps: (1) `[data-tour=upload-zone]` «Перетащите P&L, выгрузки из CRM — я извлеку метрики.»; (2) `[data-tour=doc-list]` «Статус обработки виден здесь.»; + mascot.
5. **`/gri`** *(FIX TUT-05)* — anchor `[data-tour=gri-index]` not `h1`. Steps: (1) index «GRI 0–10 по 7 блокам.»; (2) `[data-tour=top-limits]` «Смотрите на топ-ограничения — с них начинается рост.»; + mascot.
6. **`/client/dashboard`** *(FIX TUT-05)* — anchor `[data-tour=progress-widget]`. Steps: (1) «Прогресс диагностики и следующий шаг.»; (2) `[data-tour=quick-actions]` «Быстрые действия: анкета → документы → GRI.»; + mascot.
7. **`/insights`** *(NEW)* — «AI-инсайты по вашим данным — обновляются по мере заполнения.» + `[data-tour=insight-card]`.
8. **`/metrics`, `/point-a`, `/point-b`, `/market`, `/pulse`** — keep, re-anchor to `data-tour` (removes TUT-10).
9. **`/owner/dashboard`** *(NEW, needs TUT-01 mount)* — owner-scoped: (1) `[data-tour=portfolio-kpi]` «Сводка по всем клиентам.»; (2) `[data-tour=clients-table]` «Отсюда — в кабинет клиента.»; + mascot.
10. **`/expert/dashboard`** *(NEW, needs TUT-01 mount)* — expert-scoped: (1) `[data-tour=assigned-clients]`; (2) `[data-tour=gri-review]`; + mascot.
11. **`/owner/clients` + `/expert/clients`** *(NEW)* — «Список клиентов; клик — диагностика и план.»
12. **`/gri-free`** *(NEW, public, TUT-08)* — funnel: (1) explain free mini-GRI; (2) CTA to full. (Requires a lightweight standalone coachmark since the mascot isn't mounted publicly — or mount a minimal launcher there.)

### 5.3 Replay / skip / progress-save logic

- **Skip:** existing `Пропустить`/Esc → marks done. Add tap-on-scrim (TUT-12).
- **Replay:** keep Settings reset + «⋯» menu; ADD chat intent (§5.4) and a per-tour "↺ повторить" affordance on the final step.
- **Progress-save:** unchanged per-screen `toursDone`. NEW optional **journey** (`journeyStep` in settings): ordered `['/client/welcome','/client/onboarding','/client/onboarding/documents','/gri']`; after finishing a journey screen's tour, gently prompt "Дальше — <next>" and store `journeyStep`. FirstRunWizard reads the same journey for its progress ring (unifies TUT-13).
- **"Don't show again":** current implicit model is fine; expose an explicit "Больше не показывать подсказки" that sets `hintFrequency='off'` (already exists) — surface it on the tour's final step.

### 5.4 Assistant «Гри» integration (TUT-07)

- Add a chat quick-action chip **«Показать подсказки этой страницы»** in `AssistantChatPanel` header when `tourForScreen(currentScreen)` is non-null.
- Add an intent match (scripted, no LLM needed) for phrases: «покажи туториал», «подсказки страницы», «как тут всё работает», «проведи экскурсию» → dispatch `window.dispatchEvent(new CustomEvent('aistart:tutorial:start',{detail:{screen}}))`; `MascotAssistant` listens and calls `setTourSteps(tourForScreen(screen))`.
- If no tour exists for the screen, Гри replies: «На этой странице пока нет пошаговой экскурсии, но я отвечу на любой вопрос — спрашивайте 🐾».

### 5.5 Contextual tips

- Reuse `SCREEN_TIPS` (`hints.ts:313-324`) — one-liner in the chat panel header. **Expand** to every covered screen and to owner/expert screens. These are the cheap, always-on layer complementing tours.
- Add inline `data-tip` micro-hints on complex form fields (survey) surfaced by the existing `InlineValidationHints` component pattern.

### 5.6 Mobile overlay rules

- Card width `min(330, vw - 24)`; ≥12px gutters (fixes TUT-03).
- `placement:'sheet'` on mobile → dock card full-width at bottom above the safe-area; spotlight stays on target above it; arrow hidden in sheet mode.
- Blur active input and dismiss keyboard before a tour step that would be covered by the keyboard (fixes TUT-02).
- Coachmark overlay renders **independent of** `keyboardOpen`/mascot visibility.
- Tap-on-scrim = skip; focus trapped in card (fixes TUT-12).
- Reduced-motion: skip spring animation (already respected elsewhere via `useReducedMotion`).

### 5.7 Acceptance criteria (spec-level)

- AC-1: Every page listed in §3.1–§3.4 as a target has a `TOURS` entry anchored to a `data-tour` element that exists (enforced by a unit test).
- AC-2: `MascotLauncher` mounted in all four in-app layouts; owner & expert first-run tours run once and persist.
- AC-3: On 320/375px, every tour card fits with ≥12px gutters and remains visible with the keyboard open on the survey.
- AC-4: An unanchored tour (0 live steps) does NOT write `toursDone`.
- AC-5: Asking Гри «покажи туториал этой страницы» starts the current tour or explains none exists.
- AC-6: «Сбросить обучение» clears `toursDone` and journey; tours re-run.
- AC-7: No tour marks the wrong screen done (documents ≠ survey).

---

## 6. Product-owner questions

1. **Owner/expert onboarding priority** — mounting the mascot for owner+expert (TUT-01) is the single biggest coverage win (26 pages). Do we want the full living-cat mascot for those B2B roles, or a quieter "tours + tips only" mode (no strolling/sleeping)?
2. **Public funnel** — should `/gri-free` (the free mini-GRI acquisition page) get a guided tour? It's the top-of-funnel; a tour could lift conversion but needs a standalone launcher since the mascot isn't mounted publicly.
3. **Journey vs per-screen** — do we want a chained, resumable first-run journey (welcome→survey→docs→GRI) with a global % (TUT-13/§5.3), or keep independent per-screen tours? The journey unifies with FirstRunWizard but is more to build.
4. **Vertical variants** — the ecommerce/medical dashboards and surveys are uncovered. Do those verticals need their own tour copy, or is the generic survey tour acceptable?
5. **Tone/length** — current tours are 1 content step + mascot. Should key pages (GRI, Point A/B) get richer 3–4-step tours, or stay minimal to avoid fatigue?
6. **Explicit "don't show tips again"** — acceptable to keep the current implicit model (a completed tour never repeats), or do you want a visible global "Отключить обучение" switch on the first tour step?
