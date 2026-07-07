# 00 — Baseline & Product Context (Audit 2026-07-07)

> Role: BASELINE auditor. This document grounds the other 9 auditors so their
> findings can be deduped against what prior audits already found and what is
> already fixed. It does NOT re-audit code deeply — it reads documentation +
> orientation files + git log + spot code-presence checks.
>
> Sources read: `docs/AUDIT-2026-07-02-buglist.md`, `docs/AUDIT-admin-panel-2026-07-04.md`,
> `docs/AUDIT-performance-2026-07-01.md`, `docs/SECURITY-AUDIT-AND-2FA-PLAN-2026-07-02.md`,
> `docs/technical-audit.md`, `docs/product-requirements-map.md`, `docs/aistart360_site_context.md`,
> `README.md`, `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `ТЗ/SuperSystem_Spec.md`,
> `specs/001-sprint1-completion/spec.md`, `git log --oneline -30`, and spot code-presence checks.

---

## 1. Business goals & product context

**What it is.** AIStart360 is a **business-diagnostics / revenue-growth SaaS portal**
("платформа роста выручки") — the productized deliverable behind a high-ticket
consulting offer. The public landing (aistart360.app) positions it as an
"AI & Experts Growth platform" promising to "ускорить рост бизнеса до $2M в год"
in 12–18 months via diagnostics → workshop → pilot → system track.

**Who it's for.** Founders/owners of B2B companies doing **$80k–150k/month** revenue,
stuck in the "Долина Смерти" (Valley of Death) — chaotic processes, can't scale,
unstable cashflow, no measurable metrics. Explicitly scarce ("Только 10 компаний в год").

**Commercial context (why quality matters).** Clients pay from **1.4M ₸** (GRI Workshop)
up to **54M ₸** (System Track, per `/pricing`). The portal *is* the product they pay for
(diagnostics, Point A/B, metrics, growth plan), so it must feel premium and must show
**honest numbers** — no mock/fabricated data (the "no-mock mandate" is the core stabilization theme).

**The core pipeline (Контур 1)** — one universal conveyor every company runs through:

```
Регистрация → Сбор данных (анкета + файлы) → Анализ рынка → Метрики (Точка А)
            → GRI-диагностика → Карта роста (Точка B) → Дашборд
```

Promise: **Аналитика → Стратегия → Действие** as a *living* dashboard that
recomputes as data changes, with AI insights at each step and an AIStart360 expert validating.
A second vertical track (Контур 2 — clinics / e-commerce) executes strategy operationally;
repo already contains `medical` + `ecommerce` verticals but Контур 1 is the stabilization scope.

**Signature artifacts.** GRI (Growth Readiness Index, 0–1000 / 7 blocks × 62 criteria),
"Точка А" (current-state snapshot), "Точка Б" (goal + gap + 90-day plan),
metrics dashboard, and the AI mascot assistant «Гри» (interactive cat, OpenRouter-backed).

**Stack.** Next.js 14 App Router · TypeScript 5 · Supabase (Auth GoTrue + Postgres + RLS + Storage + Realtime) ·
Prisma 5 (shares the same Postgres, owns *different* tables; the Prisma/bcrypt/NextAuth auth path is **dead**) ·
OpenRouter (`anthropic/claude-sonnet-4.5`, raw fetch — not the Anthropic SDK) · Resend (email) ·
Upstash Redis (rate-limit) · Inngest (jobs) · Zustand · react-query · Tailwind + shadcn/ui + framer-motion + recharts.
Deployed on **Vercel** (serverless — read-only FS, ephemeral). 100% Russian UI.
Design: premium dark glassmorphism, teal `#6effc0`, MD3 tokens.

---

## 2. User roles & main flows

### Roles

| Role | Source in code | Purpose |
|---|---|---|
| **client** (company owner) | `profiles.role='client'` | Fills survey, uploads files, sees own Point A / GRI / metrics / dashboard. Gated by `profiles.status` (pending_approval → approved). |
| **expert** (`manager`, `analyst` normalize → expert) | `profiles.role`, `EXPERT_ROLES` | Validates AI output, comments, views assigned clients. `(expert)` route group. |
| **owner / admin** | `profiles.role` | Platform ops, approvals, portfolio view. `(owner)` + `(dashboard)/admin`. `rbac.ts` maps owner→SUPER_ADMIN. |
| **super_admin (ГИГА-панель)** | HMAC-signed cookie `aistart360_giga`, shared `GIGA_ADMIN_PASSWORD` | Internal super-admin console `/admin-giga-panel` — review requests, impersonate, 2FA-reset. Separate weak login by shared password. |

Role taxonomy is **fractured**: UPPERCASE Prisma enum (`SUPER_ADMIN|ADMIN|MANAGER|ANALYST|CLIENT`)
vs lowercase Supabase (`admin|expert|owner|client|super_admin`), with 3 different normalizers.

### Main flows

1. **Register** (landing / `/register` / Google OAuth / demo) → `profiles` row via `handle_new_user` trigger, `status='pending_approval'` + `admin_requests` row.
2. **Waiting room** (`/client/waiting-room`) polls `/api/client/status` until admin approves.
3. **Welcome / vertical pick** (`/client/welcome`) → generic / medical / ecommerce; onboarding path (survey / files / dashboard).
4. **Onboarding survey** (`/client/onboarding`, **12 steps** — diverged from doc's "7 blocks") + file upload → `survey_answers`, `documents`.
5. **Point A** recomputed from answers + parsed docs → `/client/point-a` (`diagnostics` table, versioned `is_current`).
6. **GRI diagnostic** (62-criteria) → `gri_assessments`, TOP-5 limits (partly not computed).
7. **Point B** goals + gap + 90-day plan → `/client/point-b`.
8. **Dashboard** consolidates everything → `/dashboard` (owner) / `/client/dashboard`.
9. **Admin/staff approve** — three competing backends write to three status fields (see prior-audit table).
10. **Giga-panel super-admin** — requests review + impersonate + 2FA reset (shared-password session).

---

## 3. Consolidated prior-audit status table

Five prior audits (chronological): **technical-audit.md (2026-06-11)**, **AUDIT-performance-2026-07-01**,
**AUDIT-2026-07-02-buglist**, **SECURITY-AUDIT-AND-2FA-PLAN-2026-07-02**, **AUDIT-admin-panel-2026-07-04**.

Status derived from git log (`8deeb51`…`8638478`) + spot code-presence checks. Legend:
✅ Fixed · ◐ Partially fixed · ☐ Open · ⚠ Verify (evidence ambiguous).

| # | Item (prior finding) | Prior audit | Status now | Evidence / note |
|---|---|---|---|---|
| P-1 | Priv-esc: self-register `role=owner` → SUPER_ADMIN without approval | tech-audit A3, buglist #1, sec H2 | ✅ Fixed | commits `8638478`, `92381f8`; register schema restricted, owner≠SUPER_ADMIN per sec-audit §"проверено и в порядке" |
| P-2 | `/api/pulse` authed by unsigned legacy cookie, default 'expert' | buglist #2 | ◐ Partial | middleware page-fallback removed (A7 pages); API-side resolveCallerContext fix status unverified — **re-check** |
| P-3 | Dead NextAuth stack breaks live CRM (Settings/Pulse always 401) | buglist #3, tech-audit | ☐ Open | `lib/auth.ts` + `lib/auth.config.ts` **still present** (verified). CRM tab likely still broken. |
| P-4 | Client nav ↔ middleware mismatch (5 items redirect, 1 → 404) | buglist #4/#16/#18, tech-audit | ◐ Partial | `8e3f44c` "nav↔middleware sync"; but `/market/monitoring` page **still absent** (verified) → 404 remains |
| P-5 | 4 parallel auth mechanisms; dead `aistart360_user_id` cookie is Priority-1 userId source | buglist #5, tech-audit A7 | ☐ Open | `app/actions/auth.ts` (dead staff-cookie setter) **still present** (verified); readers likely still present |
| P-6 | ~37 dead files / ~5.9k lines | buglist #6 | ◐ Partial | `aafe0a1` removed 7 components/hooks, `254edb4` removed 6 deps, `70c19c4` removed dead GRI writer; many remain (ThemeSwitcher.tsx **still present**) |
| P-7 | Unprotected+dead API: diagnostics/trigger, dashboard/kpi, pulse/briefing | buglist #7 | ◐ Partial | `dashboard/kpi` + `diagnostics/trigger` **gone** (verified); `pulse/briefing` **still present** (verified) — check auth+rate-limit |
| P-8 | 9 unused npm deps | buglist #8 | ◐ Partial | `254edb4` removed 6 unused deps; a few may remain |
| P-9 | Dual Supabase factories + 3 data idioms | buglist #9, tech-audit B4 | ☐ Open | No consolidation commit seen |
| P-10 | 3 incompatible role taxonomies | buglist #10, tech-audit | ☐ Open | No unification commit; still UPPERCASE vs lowercase + 3 normalizers |
| P-11 | Duplicate surfaces (owner forks, 2nd UI kit, vertical dashboards) | buglist #11 | ☐ Open | Not addressed |
| P-12 | Waiting-room/documents "Выход" doesn't sign out (Supabase session survives) | buglist #15 | ⚠ Verify | No specific commit; re-check the two logout handlers |
| P-13 | Report upload writes to `public/uploads` via fs (fails on Vercel RO-FS) | buglist #19, sec M6 | ☐ Open | Marked "остаётся" in sec-audit; no Storage-migration commit seen |
| P-14 | Password-reset rejects hash-fragment token (implicit flow) | buglist #20, tech-audit B2 | ✅ Fixed | `6052069` "password-reset hash flow" |
| P-15 | Owner/expert have NO mobile nav; dead bell button | buglist #22 | ◐ Partial | `8e3f44c` "mobile nav for staff" — verify covers both (owner+expert) |
| P-16 | 4 sonner Toasters → toast shows 2–3× | buglist #23, perf F06 | ⚠ Verify | No explicit commit; re-check locals in AssistantChatPanel/GRICalculator/MarketAnalysisChecklist |
| P-17 | Bottom nav overlaps content; `.safe-area-bottom` class undefined | buglist #24, `6052069` mobile overflow | ◐ Partial | `6052069` "mobile overflow"; but `.safe-area-bottom` **still undefined** in globals.css/tailwind (verified) |
| P-18 | Theme switcher (Light/Dark/System) does nothing; ThemeSwitcher.tsx dead | buglist #25 | ☐ Open | `ThemeSwitcher.tsx` **still present** (verified); 0 `dark:` classes |
| P-19 | Welcome/vertical-pick unreachable (company row created at register) | buglist #17 | ☐ Open | Not addressed |
| P-20 | Choco demo data + mock metrics shown to real users | tech-audit D1–D8, req-map | ✅ Fixed | `3e7bb8d` (TR-2 fabricated numbers removed), D1 "fully removed" in tech-audit; owner/expert GRI hardcode (D7) may remain |
| P-21 | GRI via `Math.random()` in Inngest path | tech-audit D2 | ✅ Fixed | tech-audit marks ☑ guarded; legacy writer removed `70c19c4` |
| P-22 | `/api/v1/metrics` returns MOCK when empty/on error (200) | tech-audit D3, perf B12 | ◐ Partial | D3 marked ☑; but perf B12 (200-on-error) — verify status code fix landed |
| P-23 | AI calls could hang forever (no timeout) | perf B01–B03 | ✅ Fixed | `AbortSignal.timeout` added (perf marks ИСПРАВЛЕНО); parallelize B03 may remain |
| P-24 | AI DoS: anon + no-limit paid AI routes (diagnostics/ai-analyze, gri/ai-strategy, financial-analyst) | perf B04/B06, sec C1/H1 | ✅ Fixed | sec-audit "closed all Critical+High"; rate-limit + session added |
| P-25 | 3–4 auth round-trips per load | perf B07, tech-audit | ☐ Open | No `x-user-role` seeding / `cache()` commit seen — likely still open |
| P-26 | recharts in first-load JS of most routes | perf F01 | ◐ Partial | `ae14a8d` "lazy recharts"; verify coverage across all data routes |
| P-27 | FK indexes missing (26 models, 8 indexes) | perf B16, tech-audit | ☐ Open (prod) | Added to schema but **needs `prisma db push` in prod** (recurring memory note) |
| P-28 | IDOR ×3 (reports/upload, onboarding/survey, documents DELETE) | sec H3/H4/M3 | ✅ Fixed | sec-audit ИСПРАВЛЕНО (session-only identity) |
| P-29 | SSRF via documents/[id]/process (fetch file_url) | sec H6 | ✅ Fixed | sec-audit ИСПРАВЛЕНО (storage-URL validator) |
| P-30 | CRM tokens stored plaintext in DB | sec M4, admin-audit | ☐ Open | sec-audit "остаётся"; encryption deferred |
| P-31 | `xlsx` prototype-pollution/ReDoS (no upstream patch) | sec M5 | ☐ Open | "остаётся" — migrate to exceljs |
| P-32 | `next@14.2.x` HIGH advisory (image DoS, request smuggling) | sec M8 | ⚠ Verify | Check current `next` version in package.json |
| P-33 | Weak password min (6), `email_confirm:true` skips verification | sec LOW, tech-audit | ☐ Open | Backlog |
| **ADMIN-PANEL AUDIT (2026-07-04)** | | | | |
| P-34 | **P0** Giga approve silently dropped by RLS (no auth.uid()) → users stuck | admin-audit B, D | ✅ Fixed | `5912139` "reliable user approval"; `8deeb51` "giga READ routes bypass RLS" — approve now via service-role |
| P-35 | **P0** 2FA permanent lockout — no admin-reset / recovery | admin-audit E | ✅ Fixed | `5912139` "2FA recovery"; giga-admin `users/[id]/2fa-reset` route **exists** (verified) |
| P-36 | **P1** 3 sources of truth for user status (profiles.status vs admin_requests vs users) | admin-audit B | ◐ Partial | `5912139` "unified profiles.status" — verify all 3 backends consolidated |
| P-37 | **P1** camelCase/snake_case admin_requests update = no-op | admin-audit B | ✅ Fixed | part of `5912139` |
| P-38 | **P1** Optimistic giga UI, no res.ok/refetch (RequestsModule) | admin-audit B, perf U03 | ✅ Fixed | part of `5912139` reliable-approval |
| P-39 | **P1** IDOR on insights (staff edits any user's insights, no audit) | admin-audit B | ⚠ Verify | RLS `024_point_a_insights.sql:120` — no clear fix commit; **re-check** |
| P-40 | **P1** Giga-panel on shared password, actions not attributed | admin-audit B, tech-audit A2b | ☐ Open | Still HMAC shared-cookie; no per-human Supabase identity |
| P-41 | **P1** Giga-approve + insight-PATCH not audit-logged | admin-audit B | ⚠ Verify | Check `logAudit()` presence in giga-admin routes |
| P-42 | **P1** No registration-mode toggle | admin-audit B | ✅ Fixed | `6f72249` "registration-mode toggle (open\|approval\|invite)" + `040_system_settings.sql` (verified) |
| P-43 | **P1** Insights no approval gate (AI insight instantly visible) | admin-audit B | ⚠ Verify | Check insight lifecycle draft→pending→approved landed |
| P-44 | **P2** Email (Resend) degrades silently; no approve/reject emails | admin-audit B, tech-audit B7 | ☐ Open | Not clearly addressed |
| P-45 | **P2** WebAuthn single-origin (multi-origin needed) | admin-audit / 2FA | ✅ Fixed | `8deeb51` "multi-origin WebAuthn" |
| **QUESTIONNAIRE / GRI CORRECTNESS (still mostly open)** | | | | |
| P-46 | Point A scores only old `s2_revenue_*`; new finance step `s9n_*` scores 0 | tech-audit Q1 (Critical) | ☐ Open | No key-reconciliation commit seen — **high-value re-check** |
| P-47 | Survey field-key drift (`s2_*` vs `s9n_*` vs `s6_goal_*` vs `s2n_goal_*`); completion % disagrees | tech-audit Q2/Q4/Q6 | ☐ Open | Not addressed |
| P-48 | GRI Ops block only 5 criteria (spec 6–11); duplicate `op-3` id; 65 vs 62 | tech-audit G1 | ☐ Open | Not addressed |
| P-49 | GRI TOP-5 + 90-day Action Plan not computed; owner/expert GRI pages hardcoded | tech-audit G2/G3/D7, req-map | ☐ Open | Not addressed |
| P-50 | Market analysis mostly mock (`/api/market/osint`) or empty-state | tech-audit D5, req-map | ◐ Partial | D5 → empty-state; real OSINT not wired |
| P-51 | Survey→metrics ETL stubbed ("Phase 1 stub") | tech-audit Q3 | ☐ Open | Not addressed |

**Net read:** The **security** and **admin-panel** audits are largely *closed* (Critical/High
fixed across `8638478`, `92381f8`, `5912139`, `8deeb51`). The **correctness** debt
(questionnaire key-drift P-46/47, GRI TOP-5/plan P-49, Point-A scoring) and the
**architecture** debt (dead NextAuth P-3, staff-cookie P-5, dual factories P-9,
role taxonomies P-10, duplicate surfaces P-11) are **largely still open**. UX polish
(theme P-18, safe-area P-17, toasters P-16) is partial.

---

## 4. Missing inputs (needed for a deeper/definitive audit)

1. **Production runtime access** — no `.env.local`/`node_modules` in worktree; prior audits could not run `tsc`/`next build`/runtime profiling. Need a build+typecheck run and a smoke test against real Supabase.
2. **Prod DB / migration state** — is `040_system_settings` applied? Are FK indexes (P-27) pushed? Migration `011` skipped (010→012) — intentional? Need `prisma db push` confirmation and applied-migrations list.
3. **Production logs & error monitoring** — no Sentry/observability feed; silent email/telegram failures (P-44) invisible without logs.
4. **Analytics / usage data** — no funnel data (how many clients stuck in waiting-room, onboarding drop-off, which nav items 404 in practice). Vercel Web Analytics / Speed Insights not confirmed enabled.
5. **Screenshots / visual QA of the 4 role experiences** on desktop + mobile (<1024px) — needed to confirm nav/toaster/safe-area/theme fixes landed visually.
6. **The full audit PDF** (`ТЗ/План для реализации/AIStart360_Full_Audit_Report.pdf`, 1.6MB) and `AIStart360.csv` (GRI question source) — not parsed here; may hold canonical GRI 62-criteria spec to validate P-48/P-49.
7. **Product decision log** — several items are product decisions, not bugs (GRI "Pulse" naming overload, Insights/Intelligence/Competitors pages scope, 7-blocks-vs-12-steps). Need owner ruling to classify.
8. **Current `next` version** — to close/confirm P-32 advisory.

---

## 5. Product-owner questions

1. **Auth cleanup scope:** Is the dead NextAuth + Prisma/bcrypt + staff-cookie stack (`lib/auth.ts`, `app/actions/auth.ts`, `specs/001-sprint1-completion` which still describes bcrypt+cookie auth) safe to delete wholesale? It's blocking the live CRM feature (P-3) and enabling user-impersonation via cookie (P-5). **Note: `specs/001-sprint1-completion/spec.md` is stale — it specifies the dead auth path.**
2. **Giga-panel future (P-40):** Consolidate onto `(dashboard)/admin` + `/api/admin/*` (real Supabase super_admin identity + audit), or keep the shared-password giga-panel? Prior audit recommends consolidation.
3. **Questionnaire canonical keys (P-46/P-47):** This is the highest-value open correctness bug — a client filling the *current* finance form scores 0 on Point A. Confirm the canonical field-key set (`s9n_*`) and completion-% source so it can be fixed once.
4. **GRI spec (P-48/P-49):** Is the canonical spec 62 criteria across 7 blocks (per docs/CSV)? Should TOP-5 + 90-day Action Plan be auto-computed now (currently hardcoded on owner/expert pages)?
5. **Insights/Intelligence/Competitors pages:** Are these core client deliverables or a portfolio "holding" view (built around the removed Choco case)? Determines whether they get real data sources or get removed.
6. **"GRI Pulse" naming:** `/api/pulse` is a CRM sales-pipeline monitor, not a GRI health-check survey. Rename, build the survey, or hide for clients (currently near-empty for role=client)?
7. **Verticals (medical/ecommerce):** Are the forked dashboards/onboarding intentional per-vertical, or should they collapse to one parameterized surface (P-11, P-19)?
8. **Report storage (P-13):** Confirm migrating report upload from `public/uploads` (broken on Vercel) to Supabase Storage — it's currently a hard prod failure.

---

## 6. Notes for the other 9 auditors (dedupe guidance)

- **Do NOT re-report as new:** P-1, P-14, P-20, P-21, P-23, P-24, P-28, P-29, P-34, P-35, P-37, P-38, P-42, P-45 (all verified Fixed). If you find them still broken, that's a *regression* finding — flag as such.
- **Confirm-and-close candidates (⚠ Verify):** P-2, P-12, P-16, P-22, P-32, P-39, P-41, P-43 — evidence ambiguous; a quick code check will resolve.
- **Still-open, high-value (prioritize):** P-46/P-47 (survey key-drift → Point A scores 0), P-49 (GRI TOP-5/plan not computed), P-3 (dead NextAuth breaks CRM), P-5 (staff-cookie impersonation), P-25 (auth round-trips), P-13 (report upload breaks on Vercel), P-40 (giga shared-password).
- **Known "do-not-touch without a plan"** (buglist #14): `middleware.ts` + `lib/supabase/middleware.ts` + `lib/giga-cookie*.ts` (session line of defense); RLS migrations 006/007 (profiles recursion); `prisma db push` (no migration history — destructive); `next.config.mjs` pdfkit/outputFileTracing + CSP for Mark-analytics iframe; JetBrains Mono hardcoded in charts/PDF (intentional).
- **Mark-analytics** is a vendored sub-app (market intelligence) integrated via SPA + serverless read-API (`ca40a9e`); `tsconfig` excludes it. Treat as a separate surface.
