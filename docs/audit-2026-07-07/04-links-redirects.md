# Links & Redirects Audit — AIStart360 Portal

**Date:** 2026-07-07
**Auditor role:** Dedicated LINKS & REDIRECTS auditor
**Scope:** Next.js 14 App Router app — `app/`, `components/`, `lib/`, `middleware.ts`, `next.config.mjs`. Excludes `node_modules/`, `Mark-analytics/` (vendored SPA), `Design/`, `Скиллы/`, `ТЗ/`.
**ID prefix:** LNK
**Rule:** Every external domain flagged. Every unclear/broken/suspicious link becomes a product-owner (PO) question. No source code modified — the only write is this report.

---

## 1. Summary

The portal's navigation is overwhelmingly **internal and well-guarded**. `middleware.ts` performs only same-origin, role-based `NextResponse.redirect` calls (all constructed via `new URL(path, request.url)` against fixed internal paths); `next.config.mjs` declares **no** `redirects()` or `rewrites()`, and ships a strong CSP (`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `object-src 'none'`, `connect-src`/`frame-src` restricted to `'self'`, `*.supabase.co`, and the market SPA origin).

**Link inventory (application code only):**
- **Internal navigations** (`<Link>`, `<a href="/…">`, `router.push`/`replace`, server `redirect()`, middleware redirects): **~95** distinct call sites — all point to internal paths.
- **External / off-origin links & bridges:** **~15** distinct call sites across **11 external domains**.
- **All 14 `<a target="_blank">` anchors carry `rel="noopener noreferrer"`** — clean.

**The two material problems are redirect-target injection, not tab-hijacking:**
1. **`app/auth/callback/route.ts` — OPEN REDIRECT (High).** `next = searchParams.get('next')` is fed straight into `new URL(next, origin)`. Verified: `next=https://evil.example.com/phish` and `next=//evil.com` both resolve to the **external** host. The OAuth callback is reachable by anonymous users.
2. **Customer-facing email points at a possibly-dead domain (High/PO).** `app/api/public/mini-gri/route.ts` hardcodes the CTA `https://aistart360.com/register`, and `lib/email.ts` sends `from: notifications@aistart360.com`, while the entire rest of the app uses `aistart360.vercel.app` / `aistart360.app` / `AUTH_URL`. If `.com` is not the live product domain, every mini-GRI lead is sent to a wrong/parked page.

Lower-severity items: two client-side redirect params (`from` on `/login` and `/2fa`) reach `router.push/replace` without a same-origin guard; three giga-panel `window.open` calls lack the `noopener` window-feature; the `/market` iframe bridges the live Supabase session to an external SPA origin (done correctly with a scoped `targetOrigin`, but worth PO awareness); and one impersonation magic-link builds `redirectTo` from a caller-supplied `redirectTo` string.

**Counts:** ~95 internal links, ~15 external/off-origin links, **11 external domains**. **9 items require product-owner confirmation** (see §5).

---

## 2. Findings table

| ID | Sev | Source Page (file:line) | Element | Current Link | Destination | Int/Ext | Issue | Recommendation | Ask PO? |
|----|-----|------------------------|---------|--------------|-------------|---------|-------|----------------|---------|
| LNK-01 | **High** | `app/auth/callback/route.ts:10,13` | OAuth GET callback | `new URL(next, origin)` where `next = searchParams.get('next')` | Arbitrary (verified `https://evil.com`, `//evil.com` escape origin) | Ext (injectable) | **Open redirect.** Unauthenticated endpoint reflects attacker-controlled `next` into a real redirect → phishing / token-relay vector | Whitelist: only accept `next` that begins with a single `/` and not `//`; else fall back to `/dashboard`. e.g. `const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'` | **Yes** |
| LNK-02 | **High** | `app/api/public/mini-gri/route.ts:162` | Mini-GRI lead email CTA | `ctaUrl: 'https://aistart360.com/register'` | `aistart360.com` (register) | Ext | **Domain inconsistency / possibly dead.** Whole app uses `aistart360.vercel.app` / `aistart360.app`; only this email + `lib/email.ts` `from` use `.com`. If `.com` isn't live, every captured lead lands on a wrong/parked page | Confirm the canonical public domain; replace hardcode with `AUTH_URL`/`NEXT_PUBLIC_APP_URL` base so it can never drift | **Yes** |
| LNK-03 | **Medium** | `app/(auth)/login/page.tsx:18,42` | Post-login fallback | `router.push(from)` where `from = searchParams.get('from')` | Any string incl. absolute URL | Ext (injectable) | `router.push('https://evil.com')` navigates off-site. Only reached in the `else`/admin branch, but `from` is unvalidated | Guard: only push `from` when it starts with `/` and not `//`; else `/dashboard` | **Yes** |
| LNK-04 | **Medium** | `app/2fa/page.tsx:11,71,103` | Post-2FA redirect | `router.replace(from)` where `from = params.get('from')` | Any string incl. absolute URL | Ext (injectable) | Same unvalidated-`from` pattern as LNK-03, on the 2FA gate | Same same-origin guard as LNK-03 | **Yes** |
| LNK-05 | **Medium** | `app/api/giga-admin/impersonate/route.ts:55` | Impersonation magic-link | `redirectTo: \`${req.nextUrl.origin}${redirectTo || '/client/dashboard'}\`` | Supabase magic-link `redirect_to` | Ext (Supabase-mediated) | `redirectTo` is caller-supplied and only prefixed with origin — `redirectTo='.evil.com'` yields `https://host.evil.com`. super_admin-only, current callers pass fixed paths | Validate `redirectTo` starts with `/` and not `//`; reject otherwise | **Yes** |
| LNK-06 | **Medium** | `components/market/MarketAppEmbed.tsx:45-46,117-119,195-204` | `/market` iframe + session bridge | iframe `src = ${NEXT_PUBLIC_MARKET_APP_URL}/?embed=1`; `postMessage({access_token,…}, targetOrigin)` | External Mark-analytics SPA origin | Ext | Live Supabase **access_token** is posted cross-origin to the market SPA. Done **correctly** (`targetOrigin = new URL(APP_URL).origin`, never `'*'`; CSP frame-src scoped). Flagging because it hands a session token to a separate app | Confirm the market SPA origin is trusted & first-party; keep `targetOrigin` scoped; consider a short-lived scoped token instead of the full session | **Yes** |
| LNK-07 | Low | `components/giga-panel/CRMModule.tsx:165`; `components/giga-panel/UserDetailPanel.tsx:133,140` | "Открыть как пользователь" | `window.open(url, '_blank')` | Internal impersonation magic-link (own origin) | Int | Missing `noopener` window feature (the opened page gets `window.opener`). URL is internal, so low risk | Add `'noopener,noreferrer'` third arg, matching `ShareButton.tsx:131` | No |
| LNK-08 | Low | `components/notifications/NotificationsFeed.tsx:78` | Notification row click | `router.push(n.link)` where `n.link` from DB | Whatever is stored in `notifications.link` | Int (data-driven) | If any code path writes an absolute URL into `notifications.link`, this becomes an in-app redirect to it. All current writers use internal paths | Assert/normalize `n.link` starts with `/` before `push`; document the invariant | **Yes** |
| LNK-09 | Low | `app/_components/CheckoutButton.tsx:56-58` | Checkout CTA | `window.location.href = data.checkoutUrl` (when not starting with `/`) | Payment-provider checkout URL from `/api/checkout` | Ext | Sends user to whatever URL the checkout session returns. Currently the acquiring flow is an intentional **stub** (`/dashboard`), so no real external hop today | When real acquiring lands, confirm the provider domain(s) and that only expected hosts are reachable | **Yes** |
| LNK-10 | Low | `components/giga-panel/ClientsModule.tsx:223` | Client website link | `<a href={client.website} target="_blank" rel="noopener noreferrer">` | Arbitrary client-entered URL | Ext (user data) | Destination is arbitrary user input; `rel` is correct so tab-hijack is mitigated. No scheme validation (a `javascript:`/`data:` value stored in `client.website` would be clickable) | Sanitize on render: only allow `http(s)://` schemes; strip otherwise | No |
| LNK-11 | Low | `components/gri/calculator/GRICalculator.tsx:816` | Share fallback URL | `window.location.href ?? 'https://aistart360.app/gri'` | `aistart360.app` fallback | Ext | Hardcoded `.app` fallback — another domain-variant (cf. LNK-02) | Align with the canonical domain decided in LNK-02 | Covered by LNK-02 |
| LNK-12 | Info | `app/page.tsx:179-182` | Landing nav anchors | `<a href="#modules/#metrics/#gri/#pricing">` | Same-page hash | Int | In-page anchors — fine | — | No |
| LNK-13 | Info | `app/page.tsx:655`, `app/(public)/terms/page.tsx:104`, `app/(public)/privacy/page.tsx:104` | Contact links | `mailto:hello@ / support@ / privacy@aistart360.app` | mailto | Ext (mail) | `.app` domain again (cf. LNK-02); otherwise standard | Confirm these inboxes exist on the canonical domain | Covered by LNK-02 |
| LNK-14 | Info | `app/(dashboard)/pulse/page.tsx:438,448,688` | CRM "docs" links | `https://dev.1c-bitrix.ru/rest_help/`, `https://www.amocrm.ru/developers/` | Bitrix24 / amoCRM docs | Ext | Third-party developer docs, opened `_blank` + `rel` correct | Verify links still resolve (vendor docs move); harmless | No |
| LNK-15 | Info | `components/dashboard/*` (8 sites: GRIDynamicsModal, RFMSegmentsGrid, GRIAssessmentRadarWidget×2, CRMConnectModal, GrowthSnapshotHero, LossMapCard, gri/assessment/GRIAssessment) | "Разобрать с экспертом" CTA | `https://tidycal.com/istart/gtm` | TidyCal booking page | Ext | External booking scheduler, hardcoded in 8 places. All have `target="_blank" rel="noopener noreferrer"` | Confirm `tidycal.com/istart/gtm` is the intended booking link; centralize into one constant to avoid drift | **Yes** |
| LNK-16 | Info | `components/market/MarketNewsTab.tsx:283` | News item link | `<a href={it.url} target="_blank" rel="noopener noreferrer">` | External news source URL (data-driven) | Ext | News URLs from feed data; `rel` correct | Same scheme-sanitization note as LNK-10 | No |
| LNK-17 | Info | `app/(dashboard)/reports/page.tsx:140,143`; `components/point-a/FileArea.tsx:434`; `components/giga-panel/UserDetailPanel.tsx:291`; `components/onboarding/shared/FileUploadField.tsx:94` | File open/download | `<a href={fileUrl / file_url} target="_blank" rel="noopener noreferrer">` (+ `download`) | Supabase Storage (`*.supabase.co`) | Ext (own storage) | Points at Supabase Storage (allowed by CSP `img-src`); `rel` correct | OK — confirm signed/expiring URLs are used for private docs (out of this audit's scope) | No |
| LNK-18 | Info | `lib/notifications.ts:243`, `lib/assistant/escalation/telegram-adapter.ts:51`, `lib/assistant/escalation/whatsapp-adapter.ts:52`, `lib/langfuse.ts:13`, `lib/ai/openrouter.ts:141,194` | Server-side integrations | `fetch('https://api.telegram.org/…')`, `graph.facebook.com`, `cloud.langfuse.com`, `openrouter.ai` | Telegram / WhatsApp / Langfuse / OpenRouter APIs | Ext (server fetch) | Backend API calls — **not** user redirects/links. Legitimate integrations | No action for link-safety; covered by API/secrets audits | No |
| LNK-19 | Info | `middleware.ts` (12 redirects), `app/actions/auth.ts:196`, `app/client/my-data/page.tsx:10`, `app/client/dashboard/page.tsx:11` | Role/auth redirects | `NextResponse.redirect(new URL('/…', request.url))`, server `redirect('/…')` | Fixed internal paths | Int | All same-origin, fixed literals — clean | — | No |

---

## 3. External domains list (deduped)

| # | Domain | Where | Purpose | Risk assessment |
|---|--------|-------|---------|-----------------|
| 1 | `aistart360.com` | `app/api/public/mini-gri/route.ts:162` (CTA), `lib/email.ts:65` (`from`) | Lead-capture email CTA + sender | **HIGH — domain inconsistency.** Diverges from `.vercel.app`/`.app` used everywhere else; may be parked/dead. See LNK-02. |
| 2 | `aistart360.app` | `GRICalculator.tsx:816`, mailto in `page.tsx`/`terms`/`privacy`, `lib/webauthn/config.ts` (RP ID) | Share fallback, contact mailtos, WebAuthn RP eTLD+1 | Medium — yet another domain variant; used as passkey RP ID, so the real prod domain matters. |
| 3 | `aistart360.vercel.app` | `lib/notifications.ts:202`, `lib/assistant/escalation/format.ts:57`, `lib/ai/openrouter.ts`, `app/api/pulse/*` | Default app base URL (`AUTH_URL` fallback), OpenRouter `HTTP-Referer` | Low — current live deploy; fine as fallback. |
| 4 | `tidycal.com` | 8 dashboard components (`/istart/gtm`) | External expert-call booking | Low-Medium — third-party scheduler; verify link + centralize. See LNK-15. |
| 5 | `*.supabase.co` | `next.config.mjs` CSP/images, file links | Auth, DB, Storage, image host | Low — first-party backend; allow-listed in CSP. |
| 6 | `openrouter.ai` | `lib/ai/openrouter.ts` | LLM inference API | Low — server-side; API-key audit territory. |
| 7 | `api.telegram.org` | `lib/notifications.ts`, `telegram-adapter.ts` | Telegram bot notifications | Low — server-side fetch. |
| 8 | `graph.facebook.com` | `lib/assistant/escalation/whatsapp-adapter.ts` | WhatsApp Cloud API (escalation) | Low — server-side fetch. |
| 9 | `cloud.langfuse.com` | `lib/langfuse.ts` | LLM observability | Low — server-side; overridable via `LANGFUSE_HOST`. |
| 10 | `fonts.googleapis.com` / `fonts.gstatic.com` | `next.config.mjs` CSP, font `<link>` | Google Fonts (Bricolage Grotesque, Material Symbols) | Low — standard; allow-listed in `style-src`/`font-src`. |
| 11 | `lh3.googleusercontent.com` | `next.config.mjs` (images/CSP) | Google account avatars (OAuth users) | Low — allow-listed image host. |
| — | `dev.1c-bitrix.ru`, `www.amocrm.ru` | `pulse/page.tsx` docs links | Vendor developer docs | Low — informational `_blank` links. |
| — | `NEXT_PUBLIC_MARKET_APP_URL` (Mark-analytics SPA origin) | `MarketAppEmbed.tsx` | Embedded «Рынок» SPA + session bridge | Medium — receives live Supabase token cross-origin. See LNK-06. |

*(Excluded as non-shipping: `example.com`, `shop.example.com`, `mycompany.bitrix24.kz`, `b24-xxx…`, `domain/rest/…` — these are placeholder/example strings in comments and provider-config docs, not live links.)*

---

## 4. Post-auth redirect logic (login → where?)

- **Password login** (`app/(auth)/login/page.tsx:20-45`): client → `/client/waiting-room` (pending) or `/client/point-a` (approved); super_admin → `/admin-giga-panel`; owner → `/owner/dashboard`; expert → `/expert/dashboard`; **else → `router.push(from)`** (unvalidated — LNK-03).
- **Middleware** (`middleware.ts:145-153`): an authenticated user hitting a public auth page is redirected by role to a fixed internal dest — clean.
- **Google OAuth** (`stores/auth.store.ts:202` → `/auth/callback`): callback then honors `next` — **open redirect, LNK-01**.
- **2FA gate** (`app/2fa/page.tsx`): after success → `router.replace(from)` (unvalidated — LNK-04). No redirect loop (`/2fa` and public paths are exempt in middleware).
- **Register** (`app/(auth)/register/page.tsx:24-32`): role-based `router.push` to fixed internal paths — clean.
- **Logout** (`Sidebar`/`Header`/`OwnerHeader`/`ExpertHeader`/`SettingsClient`/`auth.store`): all `→ /login` — clean.

## 4b. 404 / dead internal links — spot check

No obvious dead internal targets found; sampled targets (`/point-b`, `/gri`, `/metrics`, `/clients`, `/users`, `/admin/requests`, `/client/onboarding`, `/client/point-a`, `/gri-free`, `/terms`, `/privacy`, `/register`, `/login`, `/settings`, `/profile`, `/notifications`) all map to existing route directories under `app/`. A full route-existence crawl was out of scope but is recommended as a follow-up (see LNK-08's sibling risk: DB-driven `n.link` / `action.href` in `MascotAssistant.tsx:434` can point anywhere their data allows).

## 4c. Share `/r/[token]` external exposure

`middleware.ts:97-99` intentionally makes `/r` and `/r/<token>` **public (no auth)** — by design for shareable read-only reports. `app/r/[token]/page.tsx` contains only internal links (`Logo href="/"`, `/gri-free`) — no external leakage. `ShareButton.tsx` builds the link as `${window.location.origin}${json.url}` (own origin) and opens it with `window.open(link, '_blank', 'noopener,noreferrer')` — clean. Token-scope/expiry security is an access-control concern for the auth/API audit, not this links audit.

---

## 5. Links requiring product-owner confirmation (explicit list)

1. **LNK-01 — OAuth `next` open redirect** (`app/auth/callback/route.ts`). Confirm the fix: restrict `next` to internal single-slash paths. *(Also a security finding — flag to the security auditor.)*
2. **LNK-02 — `aistart360.com` in mini-GRI email + email `from`.** Which domain is canonical/live — `.com`, `.app`, or `.vercel.app`? This link is sent to every captured lead.
3. **LNK-03 — `/login?from=` unvalidated redirect.** Approve adding a same-origin guard on `from`.
4. **LNK-04 — `/2fa?from=` unvalidated redirect.** Same guard.
5. **LNK-05 — impersonation `redirectTo`.** Approve validating the super_admin-supplied `redirectTo`.
6. **LNK-06 — `/market` iframe session bridge.** Confirm the Mark-analytics SPA origin (`NEXT_PUBLIC_MARKET_APP_URL`) is a trusted first-party app allowed to receive the live Supabase access token.
7. **LNK-08 — notification `link` field.** Confirm all notification producers only ever store internal paths (else it's an in-app open-redirect surface).
8. **LNK-09 — checkout provider redirect.** When real acquiring replaces the stub, confirm the allowed payment-provider domain(s) for `window.location.href = data.checkoutUrl`.
9. **LNK-15 — `tidycal.com/istart/gtm` booking link.** Confirm this is the correct, current external booking URL (hardcoded in 8 components).

---

## 6. Positive controls observed (no action)

- No `redirects()` / `rewrites()` in `next.config.mjs`.
- Strong CSP: `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, scoped `connect-src`/`frame-src`/`img-src`/`font-src`; `X-Frame-Options: DENY`; HSTS preload; `Referrer-Policy: strict-origin-when-cross-origin`.
- **All 14** `<a target="_blank">` anchors include `rel="noopener noreferrer"`.
- All `middleware.ts` and server `redirect()` calls are same-origin, fixed literals.
- Market `postMessage` uses a **scoped `targetOrigin`** (never `'*'`) — session token is not broadcast.
- `ShareButton` `window.open` includes `noopener,noreferrer`.
- Password-reset & Google-OAuth `redirectTo` use `window.location.origin` (own origin).
