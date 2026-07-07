# RUNBOOK — LNK-02: Canonical domain + Google-login redirect to the wrong Vercel deploy

**Symptom:** on `https://portal.aistart360.app`, logging in with Google bounces the
user to `https://aistart360.vercel.app/login?from=%2Fdashboard` — a **different,
older Vercel deployment** (a friend's project), not the current app.

## Root cause (why code alone can't fix it)
The app requests the correct callback (`stores/auth.store.ts` uses
`${window.location.origin}/auth/callback` — dynamic, correct). The browser goes
to Google → back to **Supabase** `/auth/v1/callback`. Supabase then redirects to
the app's `redirect_to` **only if that URL is in its allow-list**; otherwise it
falls back to the configured **Site URL**. That Site URL is set to
`https://aistart360.vercel.app`, so every login lands there.

→ The fix is **Supabase + Vercel configuration**, done in dashboards. The code
changes below only remove stale domain defaults from server-side links.

## Canonical domain (decided with owner)
**`https://portal.aistart360.app`** is the canonical production URL.
Current live deploy: `https://ai-start360-app-client-super-system-xi.vercel.app`.
`aistart360.vercel.app` is the friend's OLD deploy and must be removed from the flow.

## Fix — do all of these

### 1. Supabase → Authentication → URL Configuration
- **Site URL:** `https://portal.aistart360.app`
- **Redirect URLs (allow-list):** add
  - `https://portal.aistart360.app/**`
  - `https://ai-start360-app-client-super-system-xi.vercel.app/**`
  - `http://localhost:3000/**` (local dev)
- **Remove** any `https://aistart360.vercel.app/**` entry.

### 2. Vercel — the CORRECT project (`ai-start360-app-client-super-system-xi`)
- Attach the domain **`portal.aistart360.app`** to THIS project (Settings →
  Domains). If it is currently attached to the friend's project, remove it there
  first.
- Env vars (Production + Preview), then redeploy:
  - `AUTH_URL = https://portal.aistart360.app`
  - `NEXT_PUBLIC_APP_URL = https://portal.aistart360.app` (if used)
- Confirm `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at
  the same Supabase project whose Site URL you just set.

### 3. Google Cloud Console (OAuth client)
- Authorized redirect URI must include your Supabase callback:
  `https://<project-ref>.supabase.co/auth/v1/callback`. (Google redirects to
  Supabase, not to the app domain, so no app-domain change is needed here.)

### 4. Email sender domain (separate — verify before changing)
`lib/email.ts` sends `from: notifications@aistart360.com`. This was **left as-is**
on purpose: the `from` domain must be **verified in Resend**, and switching it to
an unverified domain breaks ALL outbound email. Decide the verified sender domain
(`aistart360.com` vs `aistart360.app`) in Resend, then update `lib/email.ts:65`
to match. (Not a code bug — an infra decision.)

## Code changes already applied (this branch)
Centralized the base URL in `lib/site-url.ts` (`getSiteUrl()`, `AUTH_URL →
NEXT_PUBLIC_APP_URL → https://portal.aistart360.app`) and replaced 6 hardcoded
`aistart360.vercel.app` defaults + the mini-GRI `aistart360.com/register` CTA:
- `lib/notifications.ts`, `lib/assistant/escalation/format.ts`,
  `lib/ai/openrouter.ts` (×2 referer), `app/api/pulse/route.ts`,
  `app/api/pulse/briefing/route.ts`, `app/api/public/mini-gri/route.ts`,
  `app/presentation/page.tsx` (display text).

## Acceptance
- Google login on `portal.aistart360.app` stays on `portal.aistart360.app` and
  lands on the dashboard/waiting-room — never `aistart360.vercel.app`.
- Notification / escalation / mini-GRI emails link to `portal.aistart360.app`.
- `grep -rn "aistart360.vercel.app" app lib components` → only the doc comment in
  `lib/site-url.ts`.
