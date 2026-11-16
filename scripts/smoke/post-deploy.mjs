#!/usr/bin/env node
/**
 * scripts/smoke/post-deploy.mjs — the smoke check after a deploy (R4-A4, N4A-6; docs/deploy/runbook.md §7).
 *
 *   node scripts/smoke/post-deploy.mjs [--base-url https://portal.aistart360.app]
 *        [--expect-deployment <RAILWAY deployment id>] [--expect-functions <N>] [--timeout-ms 10000] [--revert]
 *   npm run smoke:prod
 *
 * READ ONLY: GET requests without cookies, tokens or secrets, one after another, redirects not
 * followed. It changes nothing on the portal (GET /api/inngest is the SDK's read-only introspection;
 * the registration PUT is a separate, deliberate step of the runbook).
 *
 * Checks:
 *   /api/healthz                200 ok, prints the deployment id (and commit); with --expect-deployment
 *                               it must be that one — the new deploy really answers. NO deploymentId at
 *                               all fails too (NV3-3): every build since R4-A4 has it on Railway, so a
 *                               missing one means the OLD code still answers (the first deploy of A4 goes
 *                               over code without it — overlap, a smoke run too early). Only --revert
 *                               (a rollback to code from before R4-A4, runbook §9) turns that into a warning;
 *   /api/health                 200, every check «ok» («unknown» — no data yet — is a warning);
 *   /, /login                   200; /login carries a Content-Security-Policy with connect-src and no
 *                               localhost / 127.0.0.1 / *.supabase.co (docs/deploy/csp.md);
 *   without a session           /client/home, /point-a, /dashboard → /login?from=<path>;
 *                               /admin-giga-panel → /giga-login; /super-expert → /super-expert/login;
 *   API without a session       /api/giga-admin/nav-badges 403, /api/v1/notifications?count=1 401,
 *                               /api/expert/sla-tasks 401, /api/cron/ops-watchdog and /api/cron/agents 401
 *                               (503 there = CRON_SECRET is not set);
 *   /api/inngest (GET)          200 with function_count > 0 (= --expect-functions when given).
 * What it cannot see — the logs and the journal ops_job_runs 15–20 min later — is printed as a reminder.
 *
 * Local mode (base URL on localhost / 127.0.0.1 — the dev server against staging, runbook §4): there is no
 * code deploy to staging, so the same smoke runs against `next dev`. What a dev server cannot have is a
 * warning there, not a failure: no deploymentId; /api/health checks other than `db` (no Workflow queue,
 * no scheduler, no Inngest locally); the dev CSP allows the local «Рынок» (localhost:5173); a cron at 503
 * (no CRON_SECRET locally); /api/inngest. Redirects, 401/403 and `db` stay strict.
 * --revert (W3B-3, NV3-3): a rollback to code from before R4-A4 — a /api/healthz without deploymentId is a
 * warning, the deployment is checked by `railway deployment list`. A deploymentId that is there and differs
 * fails always, --revert or not.
 *
 * Exit 0 — all passed (warnings allowed); 1 — something failed; 2 — bad arguments.
 * Plain ESM, Node 20+ (global fetch, AbortSignal.timeout); `fetch` is injected in tests.
 */
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROD_BASE_URL = 'https://portal.aistart360.app'
const UA = 'aistart360-post-deploy-smoke/1'
const REDIRECT = new Set([301, 302, 303, 307, 308])

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { baseUrl: PROD_BASE_URL, expectDeployment: null, expectFunctions: null, timeoutMs: 10_000, local: false, revert: false }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag}: нужно значение`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--base-url': opts.baseUrl = value(i, a); i++; break
      case '--expect-deployment': opts.expectDeployment = value(i, a).toLowerCase(); i++; break
      case '--expect-functions': opts.expectFunctions = Number(value(i, a)); i++; break
      case '--timeout-ms': opts.timeoutMs = Number(value(i, a)); i++; break
      case '--revert': opts.revert = true; break
      case '-h': case '--help': throw new UsageError('help')
      default: throw new UsageError(`неизвестный аргумент: ${a}`)
    }
  }
  let url
  try { url = new URL(opts.baseUrl) } catch { throw new UsageError('--base-url: не URL') }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new UsageError('--base-url: https:// (http:// — только localhost)')
  opts.baseUrl = url.origin
  opts.local = local
  if (opts.expectDeployment !== null && !/^[0-9a-f-]{8,64}$/.test(opts.expectDeployment)) throw new UsageError('--expect-deployment: id деплоя Railway')
  if (opts.expectFunctions !== null && !(Number.isInteger(opts.expectFunctions) && opts.expectFunctions > 0)) throw new UsageError('--expect-functions: целое > 0')
  if (!(Number.isInteger(opts.timeoutMs) && opts.timeoutMs >= 1000 && opts.timeoutMs <= 60_000)) throw new UsageError('--timeout-ms: 1000…60000')
  return opts
}

/** @typedef {{ status: number, headers: Headers, json: unknown, text: string }} Got */
/** @typedef {{ ok: boolean, warn?: boolean, got: string, note?: string }} Verdict */

const status = (expected) => (/** @type {Got} */ r) => ({ ok: r.status === expected, got: String(r.status) })

/** A redirect to `target`; with `from`, the ?from= parameter must be the requested path. */
const redirectTo = (target, from) => (/** @type {Got} */ r, base) => {
  const location = r.headers.get('location')
  if (!REDIRECT.has(r.status) || !location) return { ok: false, got: `${r.status}${location ? ` → ${location}` : ''}` }
  let loc
  try { loc = new URL(location, base) } catch { return { ok: false, got: `${r.status} → ${location}` } }
  const got = `${r.status} → ${loc.pathname}${loc.search}`
  if (loc.origin !== base) return { ok: false, got, note: 'редирект на другой хост' }
  if (loc.pathname !== target) return { ok: false, got }
  if (from && loc.searchParams.get('from') !== from) return { ok: false, got, note: `from ≠ ${from}` }
  return { ok: true, got }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The checks, in order. `verify(got, base, opts)` → Verdict.
 * @returns {Array<{ path: string, expect: string, verify: (r: Got, base: string, opts: ReturnType<typeof parseArgs>) => Verdict }>}
 */
export function checks() {
  return [
    {
      path: '/api/healthz', expect: '200 ok',
      verify: (r, _b, o) => {
        const body = /** @type {Record<string, unknown> | null} */ (r.json)
        if (r.status !== 200 || !body || body.ok !== true) return { ok: false, got: String(r.status) }
        const dep = typeof body.deploymentId === 'string' && UUID.test(body.deploymentId) ? body.deploymentId : null
        const commit = typeof body.commit === 'string' ? body.commit.slice(0, 12) : null
        const got = `200 deployment ${dep ?? '—'}${commit ? `, commit ${commit}` : ''}`
        if (o.local) return { ok: true, got, note: dep ? '' : 'локально deploymentId нет — так и должно быть' }
        // NV3-3: every build since R4-A4 reports its deploymentId on Railway — none means the old code answers
        // (the first deploy of A4 replaces code without the field). Only a rollback TO such code (--revert,
        // W3B-3) makes it a warning; then the deployment is checked by `railway deployment list`.
        // A deploymentId that is there and differs IS the wrong deployment, always.
        if (!dep) {
          return o.revert
            ? { ok: true, warn: true, got, note: `откат на код до R4-A4: deploymentId нет — ${o.expectDeployment ?? 'деплой'} сверить по railway deployment list` }
            : { ok: false, got, note: 'deploymentId нет — отвечает старый деплой (код до R4-A4); подождать SUCCESS/overlap и повторить; при откате на такой код — --revert' }
        }
        if (o.expectDeployment && dep !== o.expectDeployment) return { ok: false, got, note: `ждали деплой ${o.expectDeployment}` }
        return { ok: true, got }
      },
    },
    {
      path: '/api/health', expect: '200, все проверки ok',
      verify: (r, _b, o) => {
        const body = /** @type {{ ok?: unknown, checks?: Record<string, unknown> } | null} */ (r.json)
        const entries = Object.entries(body?.checks ?? {})
        const got = `${r.status} ${entries.map(([k, v]) => `${k}:${v}`).join(' ') || '(нет checks)'}`
        if (o.local && (r.status === 200 || r.status === 503) && body?.checks) {
          // dev server: only the database is required (staging); the rest a laptop does not run
          if (body.checks.db !== 'ok') return { ok: false, got, note: 'база staging не отвечает' }
          const rest = entries.filter(([k, v]) => k !== 'db' && v !== 'ok').map(([k]) => k)
          return rest.length ? { ok: true, warn: true, got, note: `локально: ${rest.join(', ')} — без них dev-сервер работает` } : { ok: true, got }
        }
        if (r.status !== 200 || body?.ok !== true || entries.length === 0) return { ok: false, got }
        const bad = entries.filter(([, v]) => v !== 'ok' && v !== 'unknown')
        if (bad.length) return { ok: false, got }
        const unknown = entries.filter(([, v]) => v === 'unknown').map(([k]) => k)
        return unknown.length ? { ok: true, warn: true, got, note: `нет данных: ${unknown.join(', ')} — повторить через 15 мин` } : { ok: true, got }
      },
    },
    { path: '/', expect: '200', verify: status(200) },
    {
      path: '/login', expect: '200 + CSP',
      verify: (r, _b, o) => {
        if (r.status !== 200) return { ok: false, got: String(r.status) }
        const csp = r.headers.get('content-security-policy')
        if (!csp) return { ok: false, got: '200, без CSP', note: 'нет заголовка Content-Security-Policy' }
        const problems = []
        if (!/(^|;)\s*connect-src\s/i.test(csp)) problems.push('нет connect-src')
        // the dev build allows the local «Рынок» (lib/security/csp.mjs); a production build must not
        if (!o.local && /localhost|127\.0\.0\.1/i.test(csp)) problems.push('localhost в CSP')
        if (/\*\.supabase\.co\b/i.test(csp)) problems.push('*.supabase.co в CSP')
        return problems.length ? { ok: false, got: '200 + CSP', note: problems.join(', ') } : { ok: true, got: '200 + CSP' }
      },
    },
    { path: '/client/home', expect: '→ /login?from=/client/home', verify: redirectTo('/login', '/client/home') },
    { path: '/point-a', expect: '→ /login?from=/point-a', verify: redirectTo('/login', '/point-a') },
    { path: '/dashboard', expect: '→ /login?from=/dashboard', verify: redirectTo('/login', '/dashboard') },
    { path: '/admin-giga-panel', expect: '→ /giga-login', verify: redirectTo('/giga-login') },
    { path: '/super-expert', expect: '→ /super-expert/login', verify: redirectTo('/super-expert/login') },
    { path: '/api/giga-admin/nav-badges', expect: '403', verify: status(403) },
    { path: '/api/v1/notifications?count=1', expect: '401', verify: status(401) },
    { path: '/api/expert/sla-tasks', expect: '401', verify: status(401) },
    ...['/api/cron/ops-watchdog', '/api/cron/agents'].map((p) => ({
      path: p, expect: '401',
      verify: (/** @type {Got} */ r, /** @type {string} */ _b, /** @type {{ local: boolean }} */ o) => r.status === 503
        ? (o.local
          ? { ok: true, warn: true, got: '503', note: 'локально CRON_SECRET не задан' }
          : { ok: false, got: '503', note: 'CRON_SECRET не задан: кроны не работают' })
        : { ok: r.status === 401, got: String(r.status) },
    })),
    {
      path: '/api/inngest', expect: '200, function_count > 0',
      verify: (r, _b, o) => {
        const body = /** @type {Record<string, unknown> | null} */ (r.json)
        const n = typeof body?.function_count === 'number' ? body.function_count : null
        const got = `${r.status}${n !== null ? ` function_count ${n}` : ''}`
        if (r.status !== 200 || n === null || n <= 0) {
          return o.local ? { ok: true, warn: true, got, note: 'локально Inngest может быть не настроен' } : { ok: false, got }
        }
        if (o.expectFunctions !== null && n !== o.expectFunctions) return { ok: false, got, note: `ждали ${o.expectFunctions}` }
        return { ok: true, got }
      },
    },
  ]
}

/** One GET, never following redirects, never throwing: a network error is a failed check. */
export async function probe(base, p, { fetchImpl, timeoutMs }) {
  try {
    const res = await fetchImpl(`${base}${p}`, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'user-agent': UA, accept: p.startsWith('/api/') ? 'application/json' : 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text().catch(() => '')
    let json = null
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try { json = JSON.parse(text) } catch { json = null }
    }
    return { got: { status: res.status, headers: res.headers, json, text }, error: null }
  } catch (e) {
    const name = e instanceof Error ? e.name : 'error'
    return { got: null, error: name === 'TimeoutError' || name === 'AbortError' ? `нет ответа за ${timeoutMs} мс` : `сеть: ${name}` }
  }
}

/** @returns {Promise<{ ok: boolean, rows: Array<{ mark: string, path: string, expect: string, got: string, note: string }> }>} */
export async function runSmoke(opts, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const rows = []
  for (const c of checks()) {
    const { got, error } = await probe(opts.baseUrl, c.path, { fetchImpl, timeoutMs: opts.timeoutMs })
    const v = got ? c.verify(got, opts.baseUrl, opts) : { ok: false, got: 'ошибка', note: error ?? '' }
    rows.push({ mark: !v.ok ? '✗' : v.warn ? '!' : '✓', path: c.path, expect: c.expect, got: v.got, note: v.note ?? '' })
  }
  return { ok: rows.every((r) => r.mark !== '✗'), rows }
}

export function formatTable(rows) {
  const w = (k) => Math.max(...rows.map((r) => r[k].length), k === 'path' ? 4 : 8)
  const [wp, we, wg] = [w('path'), w('expect'), w('got')]
  const line = (m, p, e, g, n) => `${m} ${p.padEnd(wp)}  ${e.padEnd(we)}  ${g.padEnd(wg)}  ${n}`.trimEnd()
  return [line(' ', 'путь', 'ожидалось', 'получено', ''), ...rows.map((r) => line(r.mark, r.path, r.expect, r.got, r.note))]
}

const HELP = `node scripts/smoke/post-deploy.mjs [--base-url https://…] [--expect-deployment <id>] [--expect-functions <N>] [--timeout-ms 10000] [--revert]
Только чтение (GET без входа). Подробно — docs/deploy/runbook.md §7.`

export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? console.log
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    if (e instanceof UsageError) {
      log(e.message === 'help' ? HELP : `${e.message}\n\n${HELP}`)
      return e.message === 'help' ? 0 : 2
    }
    throw e
  }
  log(`smoke: ${opts.baseUrl}${opts.local ? ' — локальный режим (dev-сервер против staging)' : ''} (${new Date().toISOString()})`)
  const result = await runSmoke(opts, deps)
  for (const l of formatTable(result.rows)) log(l)
  const failed = result.rows.filter((r) => r.mark === '✗').length
  const warned = result.rows.filter((r) => r.mark === '!').length
  log('')
  log(failed ? `ПРОВАЛ: ${failed} из ${result.rows.length}${warned ? `, предупреждений ${warned}` : ''}` : `OK: ${result.rows.length} проверок${warned ? `, предупреждений ${warned}` : ''}`)
  log(opts.local
    ? 'Вручную: пройти изменённый путь в браузере каждой нужной ролью (панель DEV, runbook §4).'
    : 'Вручную: логи portal и agents без ошибок; через 15–20 мин журнал ops_job_runs — все задачи ok (runbook §7).')
  return failed ? 1 : 0
}

function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
  } catch {
    return false
  }
}

if (isMainModule()) {
  main().then((code) => { process.exitCode = code }, () => { process.exitCode = 1 })
}
