# Reliability, Agents Service and Dev Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal's server-side calls to its own Supabase survive a Railway edge hiccup, run the AI-agent runtime as a separate Railway service, and add a localhost-only developer login that can enter the portal under any role.

**Architecture:** Three independent parts, each on its own branch from `main`, merged by the orchestrator. Part A wraps `fetch` for the Supabase origin (retry + optional private-network path) and makes two silent failures visible. Part B adds a `PORTAL_ROLE` switch so the same build runs either as the web portal, as the agents worker, or as both (today's behaviour, the default). Part C adds dev-only routes, a middleware bypass for maintenance/2FA and a floating panel; all of it is dead code in a production build.

**Tech Stack:** TypeScript 5, Next.js 14.2 App Router (`next start` on Railway), @supabase/ssr + supabase-js, Prisma 5, Inngest, vitest, Tailwind.

**Spec:** PO request of 2026-11-10 («Исправь всё… отдельно вынеси модуль ИИ-агентов… вход для разработки только на локалхосте под любой ролью») — questions were waived, so the decisions below are the orchestrator's. Diagnosis that Part A answers: on 2026-11-10 14:19–14:52 UTC Railway's public edge answered ~20 % of the portal's requests to `https://supabase.aistart360.app` by itself (they never reached the gateway); the bridge routes turned that into bare 503s with no log line.

## Global Constraints

- No new npm dependencies.
- Default behaviour must not change: with none of the new variables set (`SUPABASE_INTERNAL_URL`, `PORTAL_ROLE`, `AGENTS_SERVICE_URL`, `ENABLE_DEV_AUTH_ROUTES`) production behaves exactly as before, except for the retry in Part A and the two log/skip fixes.
- Anything imported by `middleware.ts` must be Edge-safe (Web APIs only, no Node built-ins).
- All user-facing copy is Russian; code, comments and commit messages are English, in the style of the surrounding files.
- The repository is public: no secrets, tokens, real e-mails or customer data in code, tests, docs or commit messages.
- TDD: write the failing test first. Run only the vitest files you touch (`npx vitest run <paths>`). Do NOT run `tsc`, `npm run build` or the whole suite — the machine has 8 GB of RAM and the orchestrator runs those once after the merge.
- Never create, copy or symlink `.env*` files into a worktree (tests must not be able to reach a real database).
- Commit on your own branch; do not push, do not open a PR. End every commit message with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Review Focus

1. A non-idempotent Supabase request (e.g. `POST /auth/v1/token?grant_type=refresh_token`) hits a connection reset after it was sent → it must NOT be sent a second time (A1 test `does not retry POST after an ambiguous network error`).
2. A request to any other host (OpenRouter, Telegram, Inngest) goes through the wrapped `fetch` → it must reach the base `fetch` with the very same arguments, once (A1 test `passes other origins through untouched`).
3. `PORTAL_ROLE=web` with no `AGENTS_SERVICE_URL` → a queued task must not run inline and the process must say so in the log, once (B4 test `web role without a service URL logs once and does not execute`).
4. A production build receives `Host: localhost`, `ENABLE_DEV_AUTH_ROUTES=1` and the dev cookie → every dev route answers 404 and middleware ignores the cookie (C1 test `production is always off`).
5. Dev mode is on and the signed-in dev account is a client → `/admin-giga-panel` is still refused; only the maintenance redirect and the staff 2FA requirement are skipped (C4 test `dev mode does not widen role access`).

---

## Part A — Supabase transport and honest errors (branch `claude/supabase-transport`)

### Task A1: `lib/supabase/transport.ts`

**Files:** Create `lib/supabase/transport.ts`; Test `tests/unit/supabase/transport.test.ts`.

**Interfaces — Produces:**

```ts
export interface TransportOptions {
  env?: { NEXT_PUBLIC_SUPABASE_URL?: string; SUPABASE_INTERNAL_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string }
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void   // default console.warn
  random?: () => number          // default Math.random
  now?: () => number             // default Date.now
}
export const MAX_RETRIES = 2
export const RETRY_DELAYS_MS = [150, 400] as const
export const INTERNAL_COOLDOWN_MS = 60_000
export type InternalPathState = 'off' | 'pending' | 'active' | 'disabled'
export function createSupabaseTransportFetch(base: typeof fetch, opts?: TransportOptions): typeof fetch & { internalState(): InternalPathState; probe(): Promise<boolean> }
export function installSupabaseTransport(opts?: TransportOptions): boolean
```

Rules (each one is a test):

- Only requests whose URL origin equals the origin of `NEXT_PUBLIC_SUPABASE_URL` are handled. Everything else, and every call whose first argument is a `Request` object, goes to `base` with the same arguments, exactly once. No valid public URL → the wrapper is a pass-through.
- A body is replayable when it is absent, a string, `URLSearchParams`, `ArrayBuffer`, a typed array, `Blob` or `FormData`. A `ReadableStream` body gets exactly one attempt.
- Retry, at most `MAX_RETRIES` times, waiting `RETRY_DELAYS_MS[n] * (1 + random() * 0.25)`:
  - response carries `x-railway-fallback: true` (Railway's edge answered by itself — e.g. 404 «Application not found» — and the application never saw the request) → any method;
  - response status 502, 503 or 504 without that header → `GET`/`HEAD` only;
  - `base` throws a network error → `GET`/`HEAD` always; other methods only when `error.cause?.code` is one of `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT` (never sent);
  - an abort (`AbortError`/`TimeoutError`, or `init.signal.aborted`) is rethrown at once.
- A discarded response has its body cancelled. When retries run out the last response is returned / the last error thrown.
- Every retry writes one line: `[supabase-transport] retry <n>/<MAX_RETRIES> <METHOD> <pathname> — <reason>` where reason is `edge fallback <status>`, `status <status>` or `network <code|name>`. Pathname only: never the query string, headers or host.
- Private path. `SUPABASE_INTERNAL_URL` unset or invalid → state `off`. Set → state `pending` until `probe()` has succeeded: `GET <internal>/auth/v1/settings` with header `apikey: NEXT_PUBLIC_SUPABASE_ANON_KEY`, success = HTTP 200 → `active`; anything else → `disabled` for the life of the wrapper plus one line `[supabase-transport] internal probe failed (<status|code>), internal path disabled`. Only in state `active` is the first attempt of a request sent to the same path and query on the internal origin. If that attempt throws a network error and the request may be re-sent (rules above), the request continues on the public origin without counting as a retry, the state becomes `disabled` for `INTERNAL_COOLDOWN_MS` (then `active` again) and one line is written: `[supabase-transport] internal path failed (<code>), using public for 60 s`. Responses from the internal origin are returned as they are (the 502/503/504 `GET` rule still applies).
- `installSupabaseTransport` replaces `globalThis.fetch` once (marker `Symbol.for('aistart360.supabaseTransport')` on the wrapper), copies the base function's own enumerable properties onto the wrapper (framework markers such as `__nextPatched` must survive), starts `probe()` without awaiting it, and returns `false` when already installed.

- [ ] Write the tests above with a scripted fake `base` fetch (name the two Review Focus tests exactly as listed).
- [ ] Run them, see them fail, implement, run again until green.
- [ ] Commit `feat(supabase): retrying transport with an optional private-network path`.

### Task A2: wire the transport in

**Files:** Modify `instrumentation.ts`, `lib/supabase/middleware.ts`, `.env.example`; Test `tests/unit/supabase/transport-wiring.test.ts` (or extend the existing instrumentation test if there is one).

**Interfaces — Consumes:** `installSupabaseTransport`, `createSupabaseTransportFetch` from A1.

- [ ] `instrumentation.ts`: inside `register()`, when `process.env.NEXT_RUNTIME === 'nodejs'`, call `installSupabaseTransport()` before the persistent-server block (every Node server, not only persistent ones). Keep the existing comment's promise: the Edge build must not pull Node-only modules.
- [ ] `lib/supabase/middleware.ts`: create one module-level `createSupabaseTransportFetch(fetch)` and pass it as `global: { fetch }` to `createServerClient`; call its `probe()` lazily on first use, not awaited. If `middleware.ts` or a module it imports calls the Supabase REST/Auth URL with a bare `fetch(`, route that call through the same wrapper.
- [ ] `.env.example`: add `SUPABASE_INTERNAL_URL=` with a two-line comment (Railway only, e.g. `http://envoy.railway.internal:8000`; leave empty elsewhere).
- [ ] Test: `register()` on the Node runtime installs the wrapper once (second call returns without re-wrapping); on the Edge runtime it does not touch `globalThis.fetch`.
- [ ] Commit `feat(supabase): install the transport on the Node runtime and in middleware`.

### Task A3: WhatsApp bridge control — failures leave a trace

**Files:** Modify `lib/omnichannel/whatsapp-bridge-control.ts`, `lib/omnichannel/whatsapp-web-portal-route.ts`, and the six routes under `app/api/webhooks/whatsapp-web/` that answer 503 from a `catch` (`session`, `commands/claim`, `commands/ack`, `outbound/authorize`, `outbound/claim`, `outbound/result`); extend their existing unit tests.

**Interfaces — Produces:** `storeError(operation: string, cause?: { status?: number; code?: string }): Error` with message `whatsapp bridge control: <operation> failed` followed by ` (status <n>, code <c>)` for the parts that are known; `logBridgeFailure(route: string, error: unknown): void` in `whatsapp-web-portal-route.ts` → `console.error('[whatsapp-web/<route>] <first line of error.message>')`.

- [ ] Every store method passes the PostgREST `status` and `error.code`; never the Supabase `message`, `details` or `hint` (they can echo row values).
- [ ] Each of the six routes calls `logBridgeFailure` in the `catch` that answers 503; the status code and body stay as they are.
- [ ] Tests: a store that throws → the route answers 503 and logs exactly one line that contains the route name and no payload values.
- [ ] Commit `fix(whatsapp-bridge): log why a control route answers 503`.

### Task A4: Telegram personal sync — not configured is not an error

**Files:** Modify `lib/telegram/personal-sync.ts`, `app/api/telegram/personal/sync/route.ts`; Test next to the existing tests for this route/module.

**Interfaces — Produces:** `telegramPersonalSyncConfigured(env?: Partial<NodeJS.ProcessEnv>): boolean` — true only when `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` and `TELEGRAM_USER_SESSION` are all non-empty.

- [ ] Route: authorised and not configured → `200 { ok: true, skipped: 'not_configured' }`, the sync is not called, nothing is logged at error level. Authorisation and the configured path are unchanged.
- [ ] Commit `fix(telegram): a personal sync that is not configured is skipped, not failed`.

---

## Part B — Agents service (branch `claude/agents-service`)

The agent runtime (`lib/agents/*`) executes queued tasks today inside the portal process: inline after enqueue, through the Inngest functions `agents-task-requested` / `agents-maintenance`, or through `GET /api/cron/agents`. Postgres claims a task atomically, so two executors never run the same task. This part lets a second Railway service built from the same repository take all of that work.

### Task B1: `lib/runtime/role.ts`

**Files:** Create `lib/runtime/role.ts`; Test `tests/unit/runtime/role.test.ts`.

```ts
export type PortalRole = 'all' | 'web' | 'agents'
export function portalRole(env?: Partial<NodeJS.ProcessEnv>): PortalRole  // PORTAL_ROLE 'web' | 'agents' (trimmed, lower-cased); anything else → 'all'
export function runsAgentWork(role?: PortalRole): boolean                 // role !== 'web'
export function servesWeb(role?: PortalRole): boolean                     // role !== 'agents'
export function agentsServiceUrl(env?: Partial<NodeJS.ProcessEnv>): string | null  // AGENTS_SERVICE_URL: valid http(s) URL, trailing slash removed; else null
```

- [ ] Tests, implementation, commit `feat(runtime): PORTAL_ROLE — web, agents or both`.

### Task B2: the schedule by role

**Files:** Modify `lib/cron/schedule.ts`, `lib/cron/runner.ts`, `tests/unit/cron/schedule.test.ts`, the runner's test.

**Interfaces — Produces:** `CronJob` gains `role?: 'web' | 'agents'` (absent = `'web'`) and `dedicatedOnly?: boolean`; `jobsForRole(role: PortalRole, jobs?: readonly CronJob[]): CronJob[]`.

- [ ] `/api/cron/agents-digest` becomes `role: 'agents'`. New entry `{ path: '/api/cron/agents', schedule: '* * * * *', role: 'agents', dedicatedOnly: true }`.
- [ ] `jobsForRole`: `'all'` → every job that is not `dedicatedOnly` (today's nine, same order); `'web'` → jobs whose role is `'web'`; `'agents'` → jobs whose role is `'agents'`, `dedicatedOnly` included.
- [ ] The runner schedules `jobsForRole(portalRole())`. `dueJobs` keeps its signature.
- [ ] Commit `feat(cron): jobs carry a role; the agents service drains the queue every minute`.

### Task B3: `/api/cron/agents` — one drain at a time, parity with the Inngest maintenance

**Files:** Modify `app/api/cron/agents/route.ts`; compare with `agentsMaintenance` in `lib/functions/agents.ts`; Test the route.

- [ ] Module-level single flight: while one call is draining, another authorised call answers `200 { ok: true, skipped: 'busy' }` at once.
- [ ] When `!runsAgentWork()` (role `web`) an authorised call answers `200 { ok: true, skipped: 'not_agents_role' }` and drains nothing.
- [ ] Everything `agentsMaintenance` does that the route does not is added to the route (the agents service has no Inngest; this route is its only maintenance loop). List what you added in the commit body.
- [ ] Commit `feat(agents): the cron route is the agents service's maintenance loop`.

### Task B4: starting a task by role

**Files:** Create `lib/agents/remote-kick.ts`; Modify `lib/agents/queue.ts`; Tests `tests/unit/agents/remote-kick.test.ts` and the queue's test.

**Interfaces — Produces:** `kickAgentsService(taskId: string, deps?: { fetch?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; log?: (line: string) => void }): Promise<'sent' | 'no_url' | 'failed'>` — `POST <agentsServiceUrl()>/api/internal/agents/kick`, headers `authorization: Bearer <CRON_SECRET>` and `content-type: application/json`, body `{"taskId":"<id>"}`, `AbortSignal.timeout(3000)`; never throws.

- [ ] `kickTask`: role `all` — exactly as today; role `agents` — inline background execution only, no Inngest event; role `web` — no Inngest event, no inline execution, `void kickAgentsService(taskId)`.
- [ ] `'no_url'` logs once per process `[agents] AGENTS_SERVICE_URL не задан — задача ждёт планового разбора очереди`; `'failed'` logs `[agents] kick failed: <status|code>` (the per-minute drain still picks the task up).
- [ ] Commit `feat(agents): the web role hands a queued task to the agents service`.

### Task B5: `POST /api/internal/agents/kick`

**Files:** Create `app/api/internal/agents/kick/route.ts`; Test it.

- [ ] `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 300`. `!runsAgentWork()` → 404. Bearer check exactly as the cron routes do it (`lib/cron-auth`) → 401 / 503. Body `{ taskId: uuid }` (zod, strict) → 400. Then `void runInBackground('agent-task:<id>', () => executeTaskById(taskId))` and `202 { ok: true }`.
- [ ] Commit `feat(agents): internal kick endpoint for the agents service`.

### Task B6: Inngest functions by role

**Files:** Create `lib/functions/registry.ts`; Modify `app/api/inngest/route.ts`; Test `tests/unit/functions/registry.test.ts`.

**Interfaces — Produces:** `inngestFunctionsForRole(role: PortalRole)` — `'all'` → the full list in today's order; `'web'` → the same without `agentsTaskRequested` and `agentsMaintenance`; `'agents'` → `[]`.

- [ ] The route serves `inngestFunctionsForRole(portalRole())`; its comments move with the list.
- [ ] Commit `feat(inngest): the web role no longer serves the agent functions`.

### Task B7: boot and health by role

**Files:** Modify `lib/runtime/server-start.ts`, `app/api/health/route.ts`, their tests.

- [ ] Role `agents`: the Workflow queue is not started (one log line says so); the cron runner and the SIGTERM handling are unchanged.
- [ ] `/api/health` on role `agents` has no «Очередь Workflow» entry and is `ok` when the database and the configuration are.
- [ ] Commit `feat(runtime): the agents role boots without the Workflow queue`.

### Task B8: documentation

**Files:** Create `docs/railway-agents-service.md` (Russian, under 80 lines); Modify `.env.example` (`PORTAL_ROLE`, `AGENTS_SERVICE_URL` with comments).

- [ ] The document covers: what the service does and does not do; its variables (`PORTAL_ROLE=agents`, `PERSISTENT_SERVER=1`, `CRON_RUNNER_ENABLED=1`, the rest as references to the portal's variables; no public domain; no pre-deploy command); the cut-over order (deploy the code → create and start the service → only then `PORTAL_ROLE=web` and `AGENTS_SERVICE_URL=http://<service>.railway.internal:<port>` on the portal → re-sync Inngest with `PUT /api/inngest`); the rollback (remove `PORTAL_ROLE` from the portal, re-sync Inngest, stop the service); the warning that `PORTAL_ROLE=web` without a running agents service leaves tasks waiting.
- [ ] Commit `docs(agents): how the separate agents service is deployed`.

---

## Part C — Developer login on localhost (branch `claude/dev-login`)

Precedent in the repo: `app/api/dev/register` (guard `NODE_ENV !== 'production' && ENABLE_DEV_AUTH_ROUTES === '1'`), `/dev/*` preview pages. Local development talks to a real Supabase project, so a session has to be a real Supabase session.

### Task C1: `lib/dev/dev-access.ts` (Edge-safe)

**Files:** Create `lib/dev/dev-access.ts`; Test `tests/unit/dev/dev-access.test.ts`.

```ts
export const DEV_MODE_COOKIE = 'aistart360_dev_mode'
export function isLocalHost(host: string | null | undefined): boolean
// hostname without port (IPv6 brackets handled) is 'localhost', '127.0.0.1', '::1' or ends with '.localhost'
export function devAccessEnabled(host: string | null | undefined, env?: Partial<NodeJS.ProcessEnv>): boolean
// ALL of: process.env.NODE_ENV !== 'production' (written literally first, so a production build folds the function to `false`);
// env.ENABLE_DEV_AUTH_ROUTES === '1'; isLocalHost(host); none of RAILWAY_ENVIRONMENT, RAILWAY_PROJECT_ID, VERCEL, PERSISTENT_SERVER is set
export function devModeOn(host: string | null | undefined, cookie: string | undefined, env?: Partial<NodeJS.ProcessEnv>): boolean
// devAccessEnabled(host, env) && cookie === '1'
```

- [ ] Tests: the full matrix, including `production is always off` (everything else favourable) and hosts `localhost:3000`, `127.0.0.1:53000`, `[::1]:3000`, `app.localhost:3000` (on) versus `portal.aistart360.app`, `192.168.1.5:3000`, `localhost.evil.com` (off).
- [ ] Commit `feat(dev): one guard for developer access — non-production, flagged, localhost only`.

### Task C2: `lib/dev/dev-accounts.ts` (Node only)

**Files:** Create `lib/dev/dev-accounts.ts`; Test `tests/unit/dev/dev-accounts.test.ts`.

```ts
export const DEV_ROLES = ['client', 'expert', 'super_expert', 'admin', 'super_admin', 'crm_manager', 'content_manager', 'analyst', 'support'] as const
export type DevRole = (typeof DEV_ROLES)[number]
export const DEV_ROLE_LABELS: Record<DevRole, string>
// 'Клиент', 'Эксперт', 'Супер-эксперт', 'Админ', 'Супер-админ', 'CRM-менеджер', 'Контент-менеджер', 'Аналитик', 'Поддержка'
export function devEmail(role: DevRole): string   // `dev-${role with '_' → '-'}@dev.aistart360.test`
export function devAccountShape(role: DevRole): { profileRole: 'client' | 'expert' | 'admin' | 'super_admin'; staffRole: StaffRole | null }
export async function ensureDevAccount(role: DevRole, admin: SupabaseClient): Promise<{ userId: string; email: string }>
```

- [ ] `devAccountShape`: `client` → `client`/null; `expert` → `expert`/null; `admin` → `admin`/`admin`; `super_admin` → `super_admin`/`super_admin`; `super_expert`, `crm_manager`, `content_manager`, `analyst`, `support` → `client`/that staff role.
- [ ] `ensureDevAccount` finds the auth user by e-mail or creates it (`email_confirm: true`, a random 32-byte password that is not kept, `user_metadata: { full_name: 'DEV · <label>', dev_account: true }`), then makes `profiles` (role, `status: 'approved'`) and `staff_roles` match `devAccountShape`. Follow how `app/api/dev/register/route.ts` and the admin user-management code already write these tables; reuse their helpers rather than new SQL. Idempotent.
- [ ] Commit `feat(dev): one developer account per role, created on first use`.

### Task C3: the dev API

**Files:** Create `app/api/dev/session/route.ts`, `app/api/dev/login/route.ts`, `app/api/dev/mode/route.ts`, `app/api/dev/logout/route.ts`; Tests under `tests/unit/dev/`.

- [ ] Every handler starts with `devAccessEnabled(request.nextUrl.host)`; off → `404 { error: 'NOT_FOUND' }` and nothing else runs.
- [ ] `GET /api/dev/session` → `{ enabled: true, devMode: boolean, roles: [{ role, label }], current: { email, role, staffRole } | null }`.
- [ ] `POST /api/dev/login` — body `{ role: DevRole }` or `{ email: string }` (zod, exactly one). Role → `ensureDevAccount`. E-mail → the account must already exist (else `404 { error: 'USER_NOT_FOUND' }`). Session: service-role `auth.admin.generateLink({ type: 'magiclink', email })`, then the cookie-bound server client `auth.verifyOtp({ token_hash, type: 'email' })` — the same exchange `app/auth/verify/route.ts` performs. Sets `DEV_MODE_COOKIE=1` (`httpOnly`, `sameSite: 'lax'`, `path: '/'`). Answers `{ ok: true, redirect }` where `redirect` comes from `lib/role-landing.ts`.
- [ ] `POST /api/dev/mode` — body `{ on: boolean }` → sets or clears `DEV_MODE_COOKIE`. `POST /api/dev/logout` → signs the Supabase session out locally, keeps the dev cookie.
- [ ] Tests: off → 404 for all four; role login calls `generateLink` then `verifyOtp` with the returned hash and answers the landing path; unknown e-mail → 404.
- [ ] Commit `feat(dev): developer session API — enter as any role or any existing account`.

### Task C4: middleware

**Files:** Modify `middleware.ts`; Test next to the existing middleware tests (`tests/unit/dev/dev-middleware.test.ts` if they cannot host it).

**Interfaces — Consumes:** `devModeOn`, `DEV_MODE_COOKIE` from C1.

- [ ] Compute `devMode` once per request from `request.nextUrl.host` and the cookie. When it is true skip exactly two gates: the maintenance-mode redirect to `/maintenance`, and the staff 2FA requirement (both the enrolment requirement under `staff_require_mfa` and the redirect to `/2fa`). Role, approval-status and section checks are untouched. One comment block explains why.
- [ ] Tests: `dev mode does not widen role access` (Review Focus 5); a production `NODE_ENV` ignores the cookie.
- [ ] Commit `feat(dev): dev mode skips the maintenance page and staff 2FA on localhost`.

### Task C5: the panel

**Files:** Create `components/dev/DevPanel.tsx` (client component); Modify `app/layout.tsx`; Test `tests/unit/dev/DevPanel.test.tsx` if the repo's vitest setup renders components (several component tests exist — follow one that works).

- [ ] `app/layout.tsx` mounts the panel behind the literal `process.env.NODE_ENV !== 'production'` so the production build drops the import and the chunk.
- [ ] On mount the panel renders nothing unless `location.hostname` is local and `GET /api/dev/session` answers 200.
- [ ] Collapsed: a small fixed pill «DEV» in the bottom-left corner above everything else. Expanded card, Russian copy, existing dark-glass tokens with the teal accent `#6effc0`:
  - тумблер «Режим разработки» with the hint «Пропускает заглушку техработ и 2FA на этом компьютере» (`role="switch"`, `aria-checked`);
  - «Войти как роль» — nine buttons labelled from `DEV_ROLE_LABELS`; a click posts to `/api/dev/login` and then `window.location.assign(redirect)`;
  - «Войти как пользователь» — an e-mail field and the button «Войти»; an unknown address shows «Такого пользователя нет»;
  - «Сейчас: <email> · <роль>» and the button «Выйти», or «Сейчас: без входа».
  Keyboard reachable, visible focus, usable at 360 px width; while a request is in flight the buttons are disabled.
- [ ] Commit `feat(dev): floating developer panel on localhost`.

### Task C6: documentation

**Files:** Create `docs/dev-login.md` (Russian, under 50 lines); Modify `.env.example` (keep/describe `ENABLE_DEV_AUTH_ROUTES`).

- [ ] Covers: how to switch it on (`ENABLE_DEV_AUTH_ROUTES=1` in `.env.local`, restart `npm run dev`), what the toggle and the role buttons do, that developer accounts live in whatever database `.env.local` points at, and why none of it can work on Railway (production build + host check + platform variables).
- [ ] Commit `docs(dev): the localhost developer login`.

---

## Part D — AI calls that fail in production today (branch `claude/ai-routing-fixes`)

Found in the production error log (2026-11-05 … 11-10). (1) The `light` chat route points at the model row `AlemLLM` of a provider on `llm.alem.ai`; the key attached to that row may only call `qwen3-8`, so every light-tier call answers `403 key not allowed to access model` and falls through to the Claude rows. A second row, `alemllm` on the provider `alem`, has no key of its own and inherits one that may only call `deepseek-ocr` — another 403 on every fallback. The rows that do work already exist (discovered): `qwen3-8` with the Qwen key and `alemllm` with the Alem LLM key, both on the same provider as `AlemLLM`. (2) Point A's structured calls ask for 1200–2000 output tokens; Russian JSON needs more, the answers are cut mid-sentence, are not valid JSON, and the retry only switches to a stronger model with the same budget, so it is cut again.

### Task D1: migration 139

**Files:** Create `supabase/migrations/139_alem_light_route_qwen.sql` with exactly this body under a header comment in the style of migration 137 (what, why, idempotent, how to apply). If a test pins the list or numbering of migrations, update it.

```sql
DO $$
DECLARE
  v_qwen uuid;
BEGIN
  SELECT m.id INTO v_qwen
    FROM public.ai_models m JOIN public.ai_providers p ON p.id = m.provider_id
   WHERE p.base_url LIKE '%llm.alem.ai%' AND m.capability = 'chat'
     AND m.model_id = 'qwen3-8' AND m.credential_id IS NOT NULL
   ORDER BY m.created_at, m.id LIMIT 1;
  IF v_qwen IS NULL THEN
    RAISE NOTICE '139: no qwen3-8 chat model with its own key — nothing changed';
    RETURN;
  END IF;

  UPDATE public.ai_models
     SET tier_hint = 'light', enabled = TRUE, updated_at = now()
   WHERE id = v_qwen;

  UPDATE public.ai_routes r
     SET model_id = v_qwen, updated_by = 'migration:139', updated_at = now()
    FROM public.ai_models m JOIN public.ai_providers p ON p.id = m.provider_id
   WHERE r.model_id = m.id AND r.capability = 'chat'
     AND p.base_url LIKE '%llm.alem.ai%' AND m.model_id = 'AlemLLM';

  UPDATE public.ai_models m
     SET tier_hint = 'light', updated_at = now()
    FROM public.ai_providers p
   WHERE p.id = m.provider_id AND p.base_url LIKE '%llm.alem.ai%'
     AND m.capability = 'chat' AND m.model_id = 'alemllm'
     AND m.credential_id IS NOT NULL AND m.tier_hint IS NULL;

  UPDATE public.ai_models m
     SET enabled = FALSE, tier_hint = NULL, updated_at = now()
    FROM public.ai_providers p
   WHERE p.id = m.provider_id AND p.base_url LIKE '%llm.alem.ai%' AND m.capability = 'chat'
     AND (
       m.model_id = 'AlemLLM'
       OR (m.model_id = 'alemllm' AND m.credential_id IS NULL AND EXISTS (
             SELECT 1 FROM public.ai_models w JOIN public.ai_providers wp ON wp.id = w.provider_id
              WHERE wp.base_url LIKE '%llm.alem.ai%' AND w.capability = 'chat'
                AND w.model_id = 'alemllm' AND w.credential_id IS NOT NULL))
     );
END $$;
```

- [ ] Check the column names against migrations 094 and 137 (`ai_models`, `ai_routes`, `ai_providers`); if one differs, follow the schema and say so.
- [ ] Commit `fix(ai): the light chat route calls qwen3-8, the model its key allows (migration 139)`. Do NOT apply the migration to any database — the orchestrator does that.

### Task D2: a cut-off structured answer gets a bigger budget

**Files:** Modify `lib/ai/structured.ts`, the layer underneath it that returns the completion (so the provider's finish reason reaches `structured.ts`), `lib/ai/point-a-analyzer.ts`; extend their unit tests.

**Interfaces — Produces:** `export const MAX_STRUCTURED_TOKENS = 8000` in `lib/ai/structured.ts`; the completion result carries `finishReason?: string` (the provider's `choices[0].finish_reason`, when it sends one).

- [ ] In the retry loop of the structured call: when an answer is not valid JSON and it was cut — `finishReason === 'length'`, or, when the provider gave no finish reason, the text (code fences stripped, trimmed) does not end with `}` or `]` — the next attempt uses `maxTokens = Math.min(previous * 2, MAX_STRUCTURED_TOKENS)` and logs `[<label>] attempt <n>: answer cut at the token limit, retrying with maxTokens=<m>`. The existing «one tier up» rule stays as it is. The budget/cost guard must see the new value (no bypass).
- [ ] Point A budgets in `lib/ai/point-a-analyzer.ts`: 1200 → 2500, 1500 → 3000, 2000 → 4000 (both).
- [ ] Tests: first answer cut with `finishReason: 'length'` → the second call carries the doubled budget and its valid JSON is returned; the cap is respected; a valid first answer makes exactly one call; an invalid but complete answer does not change the budget.
- [ ] Commit `fix(ai): a structured answer cut at the token limit is retried with a larger budget`.
