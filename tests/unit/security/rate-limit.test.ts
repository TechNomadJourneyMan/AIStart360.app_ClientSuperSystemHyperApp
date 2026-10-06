/**
 * lib/rate-limit.ts — store selection, fail-closed / fail-open policy, key
 * hashing, the 429 helper, the bounded in-memory store, and why the old
 * per-instance in-memory limiter could not enforce a limit on serverless.
 * The Postgres store against a real DB: tests/integration/db/rate-limit.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitStore, StoreDecision } from '@/lib/rate-limit/types'
import { createMemoryStore } from '@/lib/rate-limit/memory'

type RL = typeof import('@/lib/rate-limit')

async function freshModule(): Promise<RL> {
  vi.resetModules()
  return import('@/lib/rate-limit')
}

function recordingStore(decide: (key: string) => StoreDecision | Error): RateLimitStore & { keys: string[] } {
  const keys: string[] = []
  return {
    backend: 'postgres',
    keys,
    async hit(key) {
      keys.push(key)
      const d = decide(key)
      if (d instanceof Error) throw d
      return d
    },
  }
}

const failing = () => recordingStore(() => new Error('connection refused for bucket key'))

describe('selectBackend', () => {
  let rl: RL
  beforeEach(async () => { rl = await freshModule() })

  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv

  it('prefers Upstash only when both URL and token are set', () => {
    expect(rl.selectBackend(env({ NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://x', UPSTASH_REDIS_REST_TOKEN: 't' }))).toBe('upstash')
    expect(rl.selectBackend(env({ NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://x' }))).toBe('postgres')
    expect(rl.selectBackend(env({ NODE_ENV: 'production', UPSTASH_REDIS_REST_TOKEN: 't' }))).toBe('postgres')
  })

  it('never uses the in-memory store in production', () => {
    expect(rl.selectBackend(env({ NODE_ENV: 'production' }))).toBe('postgres')
    expect(rl.selectBackend(env({ NODE_ENV: 'production', RATE_LIMIT_BACKEND: 'memory' }))).toBe('postgres')
  })

  it('uses memory in tests and in dev without a database, Postgres in dev with one', () => {
    expect(rl.selectBackend(env({ NODE_ENV: 'test' }))).toBe('memory')
    expect(rl.selectBackend(env({ NODE_ENV: 'development', VITEST: 'true', DATABASE_URL: 'postgres://x' }))).toBe('memory')
    expect(rl.selectBackend(env({ NODE_ENV: 'development' }))).toBe('memory')
    expect(rl.selectBackend(env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' }))).toBe('postgres')
  })

  it('RATE_LIMIT_BACKEND forces a store (upstash only when configured)', () => {
    expect(rl.selectBackend(env({ NODE_ENV: 'test', RATE_LIMIT_BACKEND: 'postgres' }))).toBe('postgres')
    expect(rl.selectBackend(env({ NODE_ENV: 'test', RATE_LIMIT_BACKEND: 'upstash' }))).toBe('memory')
    expect(rl.selectBackend(env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x', RATE_LIMIT_BACKEND: 'memory' }))).toBe('memory')
  })
})

describe('policy when the store fails', () => {
  let rl: RL
  let errors: ReturnType<typeof vi.spyOn>
  beforeEach(async () => {
    rl = await freshModule()
    errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    errors.mockRestore()
    rl.__setRateLimitStoreForTests(null)
  })

  it('production: fail-closed buckets refuse with reason "unavailable"', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    rl.__setRateLimitStoreForTests(failing())
    for (const bucket of ['mfa-challenge', 'auth-register', 'gri-ai-strategy', 'telegram-bot', 'documents-finalize', 'some-new-bucket']) {
      const r = await rl.checkRateLimit('u1', bucket)
      expect(r, bucket).toMatchObject({ limited: true, reason: 'unavailable' })
      expect(r.retryAfterSeconds).toBeGreaterThan(0)
      expect(await rl.isRateLimitedKey('u1', bucket), bucket).toBe(true)
    }
  })

  it('production: fail-open buckets and explicit failClosed:false allow', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    rl.__setRateLimitStoreForTests(failing())
    expect(await rl.isRateLimitedKey('u1', 'events')).toBe(false)
    expect(await rl.isRateLimitedKey('u1', 'assistant:hide')).toBe(false)
    expect(await rl.isRateLimitedKey('u1', 'gri-draft', { failClosed: false })).toBe(false)
    expect(await rl.isRateLimitedKey('u1', 'events', { failClosed: true })).toBe(true)
  })

  it('RATE_LIMIT_FAIL_OPEN=1 makes every bucket fail open', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RATE_LIMIT_FAIL_OPEN', '1')
    rl.__setRateLimitStoreForTests(failing())
    expect(await rl.isRateLimitedKey('u1', 'mfa-challenge')).toBe(false)
    expect(await rl.isRateLimitedKey('u1', 'auth', { failClosed: true })).toBe(false)
  })

  it('outside production a failing store falls back to the in-memory limiter (still limits)', async () => {
    rl.__setRateLimitStoreForTests(failing())
    const results = []
    for (let i = 0; i < 4; i++) results.push(await rl.checkRateLimit('u1', 'mfa-setup', { max: 3 }))
    expect(results.map((r) => r.limited)).toEqual([false, false, false, true])
    expect(results[0].backend).toBe('memory')
  })

  it('logs once per backend, without the key or the raw identifier', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const store = failing()
    rl.__setRateLimitStoreForTests(store)
    for (let i = 0; i < 5; i++) await rl.checkRateLimit('user-secret-id-42', 'mfa-verify')
    expect(errors).toHaveBeenCalledTimes(1)
    const line = String(errors.mock.calls[0][0])
    expect(line).toContain('postgres store unavailable')
    expect(line).not.toContain('user-secret-id-42')
    expect(line).not.toContain(store.keys[0])
  })
})

describe('keys, decisions and responses', () => {
  let rl: RL
  beforeEach(async () => { rl = await freshModule() })
  afterEach(() => rl.__setRateLimitStoreForTests(null))

  it('stores see "<bucket>:<hmac>" — never the raw user id / IP', async () => {
    const store = recordingStore(() => ({ allowed: true, remaining: 4, retryAfterSeconds: 0 }))
    rl.__setRateLimitStoreForTests(store)
    await rl.isRateLimitedKey('3f2c9a10-user-id', 'mfa-challenge')
    await rl.isRateLimited(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }), 'demo-access')
    expect(store.keys[0]).toMatch(/^mfa-challenge:[A-Za-z0-9_-]{32}$/)
    expect(store.keys[1]).toMatch(/^demo-access:[A-Za-z0-9_-]{32}$/)
    expect(store.keys.join()).not.toContain('3f2c9a10')
    expect(store.keys.join()).not.toContain('203.0.113.7')
    expect(store.keys[1]).toBe(`demo-access:${rl.hashIdentifier('203.0.113.7')}`)
  })

  it('passes max and the window in whole seconds to the store', async () => {
    const seen: Array<[number, number]> = []
    rl.__setRateLimitStoreForTests({
      backend: 'postgres',
      async hit(_k, w, m) { seen.push([w, m]); return { allowed: true, remaining: 0, retryAfterSeconds: 0 } },
    })
    await rl.isRateLimitedKey('u', 'b', { max: 3, windowMs: 5 * 60_000 })
    await rl.isRateLimitedKey('u', 'b', { max: 0, windowMs: 10 })
    await rl.isRateLimitedKey('u', 'b')
    expect(seen).toEqual([[300, 3], [1, 1], [60, 10]])
  })

  it('rateLimitResponse: 429 + Retry-After over the limit, 503 when the store failed closed', async () => {
    const over = { limited: true, reason: 'limit', limit: 5, remaining: 0, retryAfterSeconds: 42, backend: 'postgres' } as const
    const res = rl.rateLimitResponse(over)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(await res.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' })

    const down = rl.rateLimitResponse({ ...over, reason: 'unavailable', retryAfterSeconds: 30 })
    expect(down.status).toBe(503)
    expect(down.headers.get('Retry-After')).toBe('30')
  })

  it('authRateLimit keeps the { success } contract (10/min) on the active store', async () => {
    for (let i = 0; i < 10; i++) expect((await rl.authRateLimit.limit('giga-auth:1.2.3.4')).success).toBe(true)
    const r = await rl.authRateLimit.limit('giga-auth:1.2.3.4')
    expect(r.success).toBe(false)
    expect(r.reset).toBeGreaterThan(Date.now())
  })

  it('pruneRateLimits is a no-op off Postgres', async () => {
    expect(await rl.pruneRateLimits()).toBe(0)
  })
})

describe('in-memory store', () => {
  it('sliding window: the previous window still counts by its overlap', async () => {
    let t = 1_000_000_020_000 + 20_000 // 20 s into a 60 s window (1_000_000_020_000 is a multiple of 60 000)
    const s = createMemoryStore({ now: () => t })
    const allowed = async (n: number) => {
      const out: boolean[] = []
      for (let i = 0; i < n; i++) out.push((await s.hit('k', 60, 10)).allowed)
      return out.filter(Boolean).length
    }
    expect(await allowed(15)).toBe(10)
    const denied = await s.hit('k', 60, 10)
    expect(denied).toMatchObject({ allowed: false, remaining: 0 })
    expect(denied.retryAfterSeconds).toBeGreaterThan(40) // window ends in 40 s, then decay
    t += 40_000 + 15_000 // 15 s into the next window: previous weight 0.75 → 7.5 used
    expect(await allowed(10)).toBe(2)
    t += 30_000 // 45 s in: weight 0.25 → 2.5 + 2 = 4.5 used
    expect(await allowed(10)).toBe(5)
  })

  it('evicts expired entries and caps the number of keys', async () => {
    let t = 0
    const s = createMemoryStore({ now: () => t, maxEntries: 100, sweepEveryMs: 1_000 })
    for (let i = 0; i < 500; i++) await s.hit(`k${i}`, 60, 5)
    expect(s.size()).toBeLessThanOrEqual(100)
    t += 3 * 60_000
    await s.hit('fresh', 60, 5)
    expect(s.size()).toBe(1)
  })
})

describe('cross-instance enforcement (why the in-memory limiter was replaced)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('two module instances with the old per-instance memory store let 2×max through', async () => {
    // Each Vercel instance loads its own copy of the module → its own counters.
    const a = await freshModule()
    const b = await freshModule()
    expect(a).not.toBe(b)
    let allowed = 0
    for (let i = 0; i < 10; i++) {
      if (!(await a.isRateLimitedKey('attacker', 'mfa-challenge', { max: 5 }))) allowed++
      if (!(await b.isRateLimitedKey('attacker', 'mfa-challenge', { max: 5 }))) allowed++
    }
    expect(allowed).toBe(10) // limit 5, yet 10 got through
  })

  it('two module instances on one shared store enforce the limit exactly', async () => {
    const shared = createMemoryStore() // stands in for Postgres / Redis
    const a = await freshModule()
    const b = await freshModule()
    a.__setRateLimitStoreForTests(shared)
    b.__setRateLimitStoreForTests(shared)
    let allowed = 0
    for (let i = 0; i < 10; i++) {
      if (!(await a.isRateLimitedKey('attacker', 'mfa-challenge', { max: 5 }))) allowed++
      if (!(await b.isRateLimitedKey('attacker', 'mfa-challenge', { max: 5 }))) allowed++
    }
    expect(allowed).toBe(5)
  })
})
