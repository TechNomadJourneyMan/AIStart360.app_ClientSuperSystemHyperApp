/**
 * scripts/smoke/post-deploy.mjs — the read-only smoke after a deploy (R4-A4, N4A-6). `fetch` is a fake
 * that plays a healthy portal; each test breaks one answer. The fake also records every request, so the
 * tests prove the smoke only ever sends GET without credentials and never follows a redirect.
 */
import { describe, expect, it } from 'vitest'
import { PROD_BASE_URL, UsageError, main, parseArgs, runSmoke } from '../../../scripts/smoke/post-deploy.mjs'

const BASE = 'https://portal.example.test'
const DEP = '7422c95b-1d2e-4f00-9a1b-0123456789ab'
const CSP = "default-src 'self'; connect-src 'self' https://supabase.example.test wss://supabase.example.test; frame-ancestors 'none'"

type Answer = { status: number; body?: unknown; headers?: Record<string, string> }
const json = (status: number, body: unknown): Answer => ({ status, body, headers: { 'content-type': 'application/json' } })
const go = (location: string): Answer => ({ status: 307, headers: { location } })

function healthy(): Record<string, Answer> {
  return {
    '/api/healthz': json(200, { ok: true, uptimeS: 30, deploymentId: DEP, commit: null }),
    '/api/health': json(200, { ok: true, checks: { db: 'ok', config: 'ok', schema: 'ok', queue: 'ok', inngest: 'ok', jobs: 'ok' } }),
    '/': { status: 200, body: '<html>' },
    '/login': { status: 200, body: '<html>', headers: { 'content-security-policy': CSP } },
    '/client/home': go(`${BASE}/login?from=%2Fclient%2Fhome`),
    '/point-a': go('/login?from=%2Fpoint-a'),
    '/dashboard': go(`${BASE}/login?from=%2Fdashboard`),
    '/admin-giga-panel': go(`${BASE}/giga-login`),
    '/super-expert': go(`${BASE}/super-expert/login?from=%2Fsuper-expert`),
    '/api/giga-admin/nav-badges': json(403, { error: 'forbidden' }),
    '/api/v1/notifications?count=1': json(401, { error: 'unauthorized' }),
    '/api/expert/sla-tasks': json(401, { error: 'unauthorized' }),
    '/api/cron/ops-watchdog': json(401, { ok: false, error: 'unauthorized' }),
    '/api/cron/agents': json(401, { ok: false, error: 'unauthorized' }),
    '/api/inngest': json(200, { function_count: 17, has_event_key: true, has_signing_key: true, mode: 'cloud' }),
  }
}

function fakeFetch(answers: Record<string, Answer | 'network' | 'timeout'>) {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    const a = answers[url.slice(BASE.length)]
    if (a === 'network') throw new TypeError('fetch failed')
    if (a === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    if (!a) return new Response('not found', { status: 404 })
    const body = a.body === undefined ? null : typeof a.body === 'string' ? a.body : JSON.stringify(a.body)
    return new Response(body, { status: a.status, headers: a.headers })
  }
  return { fetch, requests }
}

const smoke = async (patch: Record<string, Answer | 'network' | 'timeout'> = {}, args: string[] = []) => {
  const f = fakeFetch({ ...healthy(), ...patch })
  const result = await runSmoke(parseArgs(['--base-url', BASE, ...args]), { fetch: f.fetch })
  return { ...result, requests: f.requests, row: (p: string) => result.rows.find((r: { path: string }) => r.path === p)! }
}

describe('parseArgs', () => {
  it('defaults to the prod domain; https only, http only for localhost', () => {
    expect(parseArgs([]).baseUrl).toBe(PROD_BASE_URL)
    expect(parseArgs(['--base-url', 'http://localhost:3000/']).baseUrl).toBe('http://localhost:3000')
    expect(() => parseArgs(['--base-url', 'http://portal.example.test'])).toThrow(UsageError)
    expect(() => parseArgs(['--expect-deployment', 'abc; rm'])).toThrow(UsageError)
    expect(() => parseArgs(['--expect-functions', '0'])).toThrow(UsageError)
    expect(() => parseArgs(['--timeout-ms', '10'])).toThrow(UsageError)
  })
})

describe('runSmoke', () => {
  it('a healthy portal: all ✓, and only plain GETs without credentials, redirects not followed', async () => {
    const r = await smoke({}, ['--expect-deployment', DEP, '--expect-functions', '17'])
    expect(r.rows.filter((x: { mark: string }) => x.mark !== '✓')).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(15)
    expect(r.row('/api/healthz').got).toContain(DEP)
    for (const { url, init } of r.requests) {
      expect(url.startsWith(BASE)).toBe(true)
      expect(init.method).toBe('GET')
      expect(init.redirect).toBe('manual')
      expect(init.credentials).toBe('omit')
      const headers = Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase())
      expect(headers).not.toContain('authorization')
      expect(headers).not.toContain('cookie')
    }
  })

  it('another deployment answers than the one just made → ✗', async () => {
    const r = await smoke({}, ['--expect-deployment', '00000000-0000-0000-0000-000000000000'])
    expect(r.ok).toBe(false)
    expect(r.row('/api/healthz').note).toContain('ждали деплой')
  })

  // NV3-3: the first deploy of A4 replaces code WITHOUT deploymentId — a missing field must not pass as «OK».
  const OLD_HEALTHZ = json(200, { ok: true, uptimeS: 3 }) // /api/healthz of code from before R4-A4
  const OTHER = '11111111-2222-4333-8444-555555555555'

  it('NV3-3: a deploy, and /api/healthz has no deploymentId → ✗ (the old deployment still answers)', async () => {
    const r = await smoke({ '/api/healthz': OLD_HEALTHZ }, ['--expect-deployment', DEP])
    expect(r.ok).toBe(false)
    expect(r.row('/api/healthz')).toMatchObject({ mark: '✗', note: expect.stringContaining('старый деплой') })
    // without --expect-deployment too, and a deploymentId of the wrong shape is no id either
    expect((await smoke({ '/api/healthz': OLD_HEALTHZ })).ok).toBe(false)
    expect((await smoke({ '/api/healthz': json(200, { ok: true, deploymentId: 'x' }) }, ['--expect-deployment', DEP])).ok).toBe(false)
  })

  it('NV3-3 / W3B-3: a rollback (--revert) to code before R4-A4 — the field is absent → a warning, the healthy rollback passes', async () => {
    const r = await smoke({ '/api/healthz': OLD_HEALTHZ }, ['--expect-deployment', DEP, '--revert'])
    expect(r.ok).toBe(true)
    expect(r.row('/api/healthz')).toMatchObject({ mark: '!', note: expect.stringContaining('railway deployment list') })
    expect((await smoke({ '/api/healthz': OLD_HEALTHZ }, ['--revert'])).ok).toBe(true)
  })

  it('NV3-3: a deploymentId that is there and differs → ✗ always, --revert or not', async () => {
    const other = { '/api/healthz': json(200, { ok: true, deploymentId: OTHER }) }
    expect((await smoke(other, ['--expect-deployment', DEP])).ok).toBe(false)
    const reverted = await smoke(other, ['--expect-deployment', DEP, '--revert'])
    expect(reverted.ok).toBe(false)
    expect(reverted.row('/api/healthz').note).toContain('ждали деплой')
  })

  it('/api/health: a failed check or 503 fails; «unknown» only warns', async () => {
    expect((await smoke({ '/api/health': json(503, { ok: false, checks: { db: 'ok', inngest: 'fail' } }) })).ok).toBe(false)
    expect((await smoke({ '/api/health': json(200, { ok: true, checks: { db: 'ok', queue: 'fail' } }) })).ok).toBe(false)
    const unknown = await smoke({ '/api/health': json(200, { ok: true, checks: { db: 'ok', jobs: 'unknown' } }) })
    expect(unknown.ok).toBe(true)
    expect(unknown.row('/api/health')).toMatchObject({ mark: '!', note: expect.stringContaining('jobs') })
  })

  // N5-1a: the code is out without its migrations — that is a failed deploy, not a warning.
  it('/api/health: schema fail or unknown → ✗ with the hint; no schema check at all (code before N5-1a) only warns', async () => {
    const all = { db: 'ok', config: 'ok', queue: 'ok', inngest: 'ok', jobs: 'ok' }
    const behind = await smoke({ '/api/health': json(503, { ok: false, checks: { ...all, schema: 'fail' } }) })
    expect(behind.ok).toBe(false)
    expect(behind.row('/api/health')).toMatchObject({ mark: '✗', note: expect.stringContaining('миграции') })
    // 'unknown' schema is a 200, but a deploy is not «done» while the journal could not be read
    const unread = await smoke({ '/api/health': json(200, { ok: true, checks: { ...all, schema: 'unknown' } }) })
    expect(unread.row('/api/health').mark).toBe('✗')
    expect((await smoke({ '/api/health': json(200, { ok: true, checks: { ...all, schema: 'ok' } }) })).row('/api/health').mark).toBe('✓')
    const old = await smoke({ '/api/health': json(200, { ok: true, checks: all }) })
    expect(old.ok).toBe(true)
    expect(old.row('/api/health')).toMatchObject({ mark: '!', note: expect.stringContaining('schema') })
  })

  it('/login: no CSP, or a CSP with localhost / *.supabase.co / without connect-src → ✗', async () => {
    expect((await smoke({ '/login': { status: 200, body: 'x' } })).row('/login').note).toContain('нет заголовка')
    const local = await smoke({ '/login': { status: 200, headers: { 'content-security-policy': `${CSP} http://localhost:5173` } } })
    expect(local.row('/login').note).toContain('localhost')
    const cloud = await smoke({ '/login': { status: 200, headers: { 'content-security-policy': "connect-src 'self' https://*.supabase.co" } } })
    expect(cloud.row('/login').note).toContain('supabase.co')
    const noConnect = await smoke({ '/login': { status: 200, headers: { 'content-security-policy': "default-src 'self'" } } })
    expect(noConnect.row('/login').note).toContain('connect-src')
  })

  it('a protected page that opens without a session, loses ?from= or leaves the host → ✗', async () => {
    expect((await smoke({ '/client/home': { status: 200, body: '<html>' } })).row('/client/home').mark).toBe('✗')
    expect((await smoke({ '/dashboard': go('/login') })).row('/dashboard').note).toContain('from')
    expect((await smoke({ '/point-a': go('https://evil.example/login?from=%2Fpoint-a') })).row('/point-a').note).toContain('другой хост')
    expect((await smoke({ '/admin-giga-panel': go('/login?from=%2Fadmin-giga-panel') })).row('/admin-giga-panel').mark).toBe('✗')
  })

  it('an API that answers without a session → ✗; a cron at 503 says CRON_SECRET is missing', async () => {
    expect((await smoke({ '/api/giga-admin/nav-badges': json(200, {}) })).ok).toBe(false)
    expect((await smoke({ '/api/v1/notifications?count=1': json(200, { count: 0 }) })).ok).toBe(false)
    const cron = await smoke({ '/api/cron/agents': json(503, { ok: false, error: 'cron_not_configured' }) })
    expect(cron.row('/api/cron/agents').note).toContain('CRON_SECRET')
  })

  it('Inngest: no functions or not the expected number → ✗', async () => {
    expect((await smoke({ '/api/inngest': json(200, { function_count: 0 }) })).ok).toBe(false)
    expect((await smoke({}, ['--expect-functions', '18'])).row('/api/inngest').note).toBe('ждали 18')
  })

  it('a network error or a timeout is a failed check, not a crash', async () => {
    const r = await smoke({ '/': 'network', '/api/healthz': 'timeout' })
    expect(r.ok).toBe(false)
    expect(r.row('/').note).toContain('сеть')
    expect(r.row('/api/healthz').note).toContain('нет ответа')
    expect(r.rows).toHaveLength(15)
  })
})

describe('local mode — the dev server against staging (W3B-2, runbook §4)', () => {
  const LOCAL = 'http://127.0.0.1:3000'
  function devServer(patch: Record<string, Answer> = {}): Record<string, Answer> {
    return {
      ...healthy(),
      '/api/healthz': json(200, { ok: true, uptimeS: 30, deploymentId: null, commit: null }),
      // a laptop has no Workflow queue, scheduler or Inngest; the database is staging
      '/api/health': json(503, { ok: false, checks: { db: 'ok', config: 'fail' } }),
      '/login': { status: 200, headers: { 'content-security-policy': `${CSP} http://localhost:5173` } },
      '/api/cron/ops-watchdog': json(503, { ok: false, error: 'cron_not_configured' }),
      '/api/cron/agents': json(503, { ok: false, error: 'cron_not_configured' }),
      // the redirects of healthy() name the prod-like host; the dev server answers with its own
      '/client/home': go('/login?from=%2Fclient%2Fhome'),
      '/dashboard': go('/login?from=%2Fdashboard'),
      '/admin-giga-panel': go('/giga-login'),
      '/super-expert': go('/super-expert/login?from=%2Fsuper-expert'),
      ...patch,
    }
  }
  async function local(answers: Record<string, Answer>) {
    const requests: string[] = []
    const fetch = async (url: string) => {
      requests.push(url)
      const a = answers[url.slice(LOCAL.length)]
      if (!a) return new Response('not found', { status: 404 })
      const body = a.body === undefined ? null : typeof a.body === 'string' ? a.body : JSON.stringify(a.body)
      return new Response(body, { status: a.status, headers: a.headers })
    }
    const result = await runSmoke(parseArgs(['--base-url', LOCAL]), { fetch })
    return { ...result, requests, row: (p: string) => result.rows.find((r: { path: string }) => r.path === p)! }
  }

  it('is switched on by a localhost base URL', () => {
    expect(parseArgs(['--base-url', LOCAL]).local).toBe(true)
    expect(parseArgs(['--base-url', BASE]).local).toBe(false)
  })

  it('what a dev server cannot have only warns: no deploymentId, health beyond db, dev CSP, crons without a secret', async () => {
    const r = await local(devServer())
    expect(r.ok).toBe(true)
    expect(r.row('/api/healthz').mark).toBe('✓')
    expect(r.row('/api/health')).toMatchObject({ mark: '!', note: expect.stringContaining('config') })
    expect(r.row('/login').mark).toBe('✓')
    expect(r.row('/api/cron/agents').mark).toBe('!')
    expect(r.requests.every((u) => u.startsWith(LOCAL))).toBe(true)
  })

  it('stays strict where the code is under test: the staging database, redirects, 401/403, *.supabase.co', async () => {
    expect((await local(devServer({ '/api/health': json(503, { ok: false, checks: { db: 'fail', config: 'ok' } }) }))).row('/api/health').mark).toBe('✗')
    // N5-1a: staging must already carry the migrations of the code under test (runbook §4)
    const behind = await local(devServer({ '/api/health': json(503, { ok: false, checks: { db: 'ok', config: 'fail', schema: 'fail' } }) }))
    expect(behind.row('/api/health')).toMatchObject({ mark: '✗', note: expect.stringContaining('миграции') })
    expect((await local(devServer({ '/client/home': { status: 200, body: '<html>' } }))).ok).toBe(false)
    expect((await local(devServer({ '/api/v1/notifications?count=1': json(200, {}) }))).ok).toBe(false)
    const cloud = await local(devServer({ '/login': { status: 200, headers: { 'content-security-policy': "connect-src 'self' https://*.supabase.co" } } }))
    expect(cloud.row('/login').mark).toBe('✗')
  })

  // Review of wave 1A (LOW): a cold `next dev` reading the journal of a remote staging can run out of the
  // check's 3 s — `schema: unknown` locally is a flaky «not read», not «behind»: a warning there. `fail`
  // stays a failure locally, and in production `unknown` stays a failure.
  it('schema unknown locally is a warning (journal not read), schema fail locally and unknown in production fail', async () => {
    const unread = await local(devServer({ '/api/health': json(200, { ok: true, checks: { db: 'ok', config: 'ok', schema: 'unknown' } }) }))
    expect(unread.ok).toBe(true)
    expect(unread.row('/api/health')).toMatchObject({ mark: '!', note: expect.stringContaining('журнал миграций не прочитан') })
    const unreadWith503 = await local(devServer({ '/api/health': json(503, { ok: false, checks: { db: 'ok', config: 'fail', schema: 'unknown' } }) }))
    expect(unreadWith503.ok).toBe(true)
    expect(unreadWith503.row('/api/health').mark).toBe('!')

    const behind = await local(devServer({ '/api/health': json(200, { ok: true, checks: { db: 'ok', config: 'ok', schema: 'fail' } }) }))
    expect(behind.ok).toBe(false)

    const all = { db: 'ok', config: 'ok', queue: 'ok', inngest: 'ok', jobs: 'ok' }
    const prodUnread = await smoke({ '/api/health': json(200, { ok: true, checks: { ...all, schema: 'unknown' } }) })
    expect(prodUnread.ok).toBe(false)
    expect(prodUnread.row('/api/health').mark).toBe('✗')
  })
})

describe('main', () => {
  it('prints the table and the summary; 0 / 1 / 2', async () => {
    const out: string[] = []
    const log = (l: string) => out.push(l)
    expect(await main(['--base-url', BASE], { fetch: fakeFetch(healthy()).fetch, log })).toBe(0)
    expect(out.join('\n')).toContain('OK: 15 проверок')
    expect(out.join('\n')).toContain('ops_job_runs')

    out.length = 0
    expect(await main(['--base-url', BASE], { fetch: fakeFetch({ ...healthy(), '/': json(500, {}) }).fetch, log })).toBe(1)
    expect(out.join('\n')).toContain('ПРОВАЛ: 1 из 15')

    expect(await main(['--base-url', 'ftp://x'], { log: () => {} })).toBe(2)
  })
})
