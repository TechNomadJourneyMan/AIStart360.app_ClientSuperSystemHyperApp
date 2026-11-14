/**
 * R-010: the test process cannot reach real services.
 *  (a) env: .env* is not loaded, secrets / external URLs are scrubbed,
 *      DATABASE_URL never leaves the local test DB;
 *  (b) network: fetch / sockets to non-local hosts fail loudly, mocks on top work;
 *  (c) DB gates refuse a non-local TEST_DATABASE_URL / TEST_DB_ADMIN_URL.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDbTestsEnabled } from '../helpers/db-env'
import { RealNetworkInTestsError, isHostAllowedInTests } from '../helpers/network-guard'
import {
  TEST_DB_STUB_URL,
  TestEnvRefusal,
  isLocalHost,
  isLocalUrl,
  sanitizeTestEnv,
} from '../helpers/test-env-guard'

const ROOT = resolve(__dirname, '../..')
const CLOUD_DB = 'postgresql://postgres.abcd:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres'
const LOCAL_DB = 'postgres://postgres@127.0.0.1:54329/aistart360_test'

describe('(a) hermetic env — no real secrets or external addresses in the test process', () => {
  it('env-setup.ts does not load .env files', () => {
    const src = readFileSync(resolve(ROOT, 'tests/helpers/env-setup.ts'), 'utf8')
    const code = src.replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/dotenv|loadEnvConfig|['"]\.env/)
  })

  it('scrubs secrets, external-service variables and non-local URLs; keeps the rest', () => {
    const env: Record<string, string | undefined> = {
      OPENROUTER_API_KEY: 'sk-or-real',
      RESEND_API_KEY: 're_real',
      ALEM_API_KEY: 'alem-real',
      ALEM_BASE_URL: 'https://llm.alem.ai/v1',
      TELEGRAM_BOT_TOKEN: '123:real',
      TELEGRAM_ADMIN_CHAT_IDS: '1,2',
      GOOGLE_CLIENT_SECRET: 'g-real',
      GOOGLE_APPS_SCRIPT_WEBHOOK_URL: 'https://script.google.com/x',
      AUTH_GOOGLE_SECRET: 'g2-real',
      CRON_SECRET: 'cron-real',
      SUPABASE_SERVICE_ROLE_KEY: 'prod-service-role',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-anon',
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.aistart360.app',
      SUPABASE_INTERNAL_URL: 'http://supabase-kong.railway.internal:8000',
      DATABASE_URL: CLOUD_DB,
      DIRECT_URL: CLOUD_DB,
      OMNICHANNEL_DATABASE_URL: CLOUD_DB,
      NEXT_PUBLIC_APP_URL: 'https://aistart360.app',
      EMAIL_ALLOW_SEND_IN_TESTS: '1',
      // kept
      PATH: '/usr/bin',
      NODE_ENV: 'test',
      OMNICHANNEL_PROCESSING_BACKEND: 'inline',
      AGENTS_SERVICE_URL: 'http://127.0.0.1:4100',
      TEST_SUPABASE_URL: 'https://testref.supabase.co',
      TEST_SUPABASE_SERVICE_ROLE_KEY: 'disposable',
      npm_config_registry: 'https://registry.npmjs.org/',
    }
    const result = sanitizeTestEnv(env)

    for (const gone of [
      'OPENROUTER_API_KEY', 'RESEND_API_KEY', 'ALEM_API_KEY', 'ALEM_BASE_URL', 'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_ADMIN_CHAT_IDS', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_APPS_SCRIPT_WEBHOOK_URL', 'AUTH_GOOGLE_SECRET',
      'CRON_SECRET', 'SUPABASE_INTERNAL_URL', 'OMNICHANNEL_DATABASE_URL', 'NEXT_PUBLIC_APP_URL',
      'EMAIL_ALLOW_SEND_IN_TESTS',
    ]) {
      expect(env[gone], gone).toBeUndefined()
      expect(result.removed).toContain(gone)
    }
    // present-but-dummy values, all local
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:1')
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('x')
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('x')
    // no TEST_DATABASE_URL → a dead local stub, never the cloud DB
    expect(env.DATABASE_URL).toBe(TEST_DB_STUB_URL)
    expect(env.DIRECT_URL).toBe(TEST_DB_STUB_URL)
    // the rest survives
    expect(env.PATH).toBe('/usr/bin')
    expect(env.NODE_ENV).toBe('test')
    expect(env.OMNICHANNEL_PROCESSING_BACKEND).toBe('inline')
    expect(env.AGENTS_SERVICE_URL).toBe('http://127.0.0.1:4100')
    expect(env.TEST_SUPABASE_URL).toBe('https://testref.supabase.co')
    expect(env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBe('disposable')
    expect(env.npm_config_registry).toBe('https://registry.npmjs.org/')
    // the original app URL is remembered (for the "is it the app project?" check), not kept in env
    expect(result.appSupabaseUrls).toEqual(['https://supabase.aistart360.app'])
  })

  it('points DATABASE_URL / DIRECT_URL at a local TEST_DATABASE_URL', () => {
    const env: Record<string, string | undefined> = { TEST_DATABASE_URL: LOCAL_DB, DATABASE_URL: CLOUD_DB }
    sanitizeTestEnv(env)
    expect(env.DATABASE_URL).toBe(LOCAL_DB)
    expect(env.DIRECT_URL).toBe(LOCAL_DB)
  })

  it('the live test process is already scrubbed', () => {
    for (const name of ['OPENROUTER_API_KEY', 'RESEND_API_KEY', 'ALEM_API_KEY', 'TELEGRAM_BOT_TOKEN', 'GOOGLE_CLIENT_SECRET']) {
      expect(process.env[name], name).toBeFalsy()
    }
    expect(isLocalUrl(process.env.DATABASE_URL)).toBe(true)
    expect(isLocalUrl(process.env.DIRECT_URL)).toBe(true)
    expect(isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)).toBe(true)
    for (const [name, value] of Object.entries(process.env)) {
      if (!value || name.startsWith('TEST_') || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) expect(isLocalUrl(value), `${name} points outside`).toBe(true)
    }
  })
})

describe('(b) network guard — only 127.0.0.1 / localhost / ::1', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies hosts', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'app.localhost', '::1', '[::1]']) expect(isLocalHost(h), h).toBe(true)
    for (const h of ['example.com', '10.0.0.5', '0.0.0.0x', 'supabase.aistart360.app', '1.1.1.1']) expect(isLocalHost(h), h).toBe(false)
    expect(isHostAllowedInTests('api.example.test', { TEST_NETWORK_ALLOW_HOSTS: 'other, api.example.test' })).toBe(true)
    expect(isHostAllowedInTests('testref.supabase.co', { TEST_SUPABASE_URL: 'https://testref.supabase.co' })).toBe(true)
    expect(isHostAllowedInTests('prod.supabase.co', { TEST_SUPABASE_URL: 'https://testref.supabase.co' })).toBe(false)
  })

  it('fetch to an external host fails with a clear error', async () => {
    await expect(fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' })).rejects.toThrow(
      /Реальная сеть в тестах запрещена.*openrouter\.ai/,
    )
    await expect(fetch(new Request('https://api.resend.com/emails'))).rejects.toBeInstanceOf(RealNetworkInTestsError)
  })

  it('raw sockets and http(s).request to an external host fail too', async () => {
    const viaHttps = await new Promise<Error>((done) => {
      const req = https.request('https://api.telegram.org/bot1/sendMessage', { method: 'POST' })
      req.on('error', done)
      req.end()
    })
    expect(viaHttps).toBeInstanceOf(RealNetworkInTestsError)

    const viaSocket = await new Promise<Error>((done) => {
      net.connect({ host: '1.1.1.1', port: 443 }).on('error', done)
    })
    expect(viaSocket).toBeInstanceOf(RealNetworkInTestsError)

    const viaPortHost = await new Promise<Error>((done) => {
      new net.Socket().on('error', done).connect(5432, 'db.example.supabase.co')
    })
    expect(viaPortHost).toBeInstanceOf(RealNetworkInTestsError)
  })

  it('local servers stay reachable through fetch and sockets', async () => {
    const server = http.createServer((_, res) => res.end('ok'))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      expect(await res.text()).toBe('ok')
      const res2 = await fetch(`http://localhost:${port}/`).catch(() => null)
      // localhost may resolve to ::1 first where the server is not listening; the guard must not be the reason.
      if (res2) expect(await res2.text()).toBe('ok')
      await new Promise<void>((ok, fail) => {
        const s = net.connect({ host: '127.0.0.1', port }, () => {
          s.destroy()
          ok()
        })
        s.on('error', fail)
      })
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('a test that mocks fetch keeps its mock (mock sits on top of the guard)', async () => {
    const mock = vi.fn(async () => new Response('mocked'))
    vi.stubGlobal('fetch', mock)
    const res = await fetch('https://openrouter.ai/api/v1/models')
    expect(await res.text()).toBe('mocked')
    expect(mock).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
    await expect(fetch('https://openrouter.ai/api/v1/models')).rejects.toBeInstanceOf(RealNetworkInTestsError)
  })

  it('a spy with its own implementation also works', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('spied'))
    try {
      const res = await fetch('https://api.resend.com/emails')
      expect(await res.text()).toBe('spied')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('(c) DB gates accept only a local database', () => {
  it('db-env: off without TEST_DATABASE_URL, on for local, refuses remote', () => {
    expect(resolveDbTestsEnabled({})).toBe(false)
    expect(resolveDbTestsEnabled({ TEST_DATABASE_URL: LOCAL_DB })).toBe(true)
    expect(resolveDbTestsEnabled({ TEST_DATABASE_URL: 'postgres://u@localhost/t' })).toBe(true)
    expect(resolveDbTestsEnabled({ TEST_DATABASE_URL: 'postgres://u@[::1]:5432/t' })).toBe(true)
    for (const remote of [CLOUD_DB, 'postgres://u@reserve-db.example.com:5432/t', 'postgres://u@10.0.0.7/t', 'not a url']) {
      expect(() => resolveDbTestsEnabled({ TEST_DATABASE_URL: remote }), remote).toThrow(TestEnvRefusal)
    }
  })

  it('env-setup refuses a non-local TEST_DATABASE_URL / TEST_DB_ADMIN_URL', () => {
    expect(() => sanitizeTestEnv({ TEST_DATABASE_URL: CLOUD_DB })).toThrow(/TEST_DATABASE_URL.*нелокальный/)
    expect(() => sanitizeTestEnv({ TEST_DB_ADMIN_URL: CLOUD_DB })).toThrow(/TEST_DB_ADMIN_URL/)
  })

  it('scripts/test-db/setup.mjs refuses a non-local admin URL before connecting', () => {
    for (const url of [CLOUD_DB, 'postgres://postgres@reserve.example.com:5432/postgres']) {
      const run = spawnSync(process.execPath, [resolve(ROOT, 'scripts/test-db/setup.mjs'), '--quiet'], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, TEST_DB_ADMIN_URL: url },
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(run.status, url).toBe(1)
      expect(run.stderr).toMatch(/Refusing to run against non-local host/)
    }
  })
})
