/**
 * Rate limiting on the real database (migration 100): public.rate_limit_hit /
 * rate_limit_prune and the Postgres store of lib/rate-limit.ts.
 * Run: node scripts/test-db/setup.mjs --db aistart360_w2 &&
 *      TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/aistart360_w2 npx vitest run <this file>
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('rate limits in Postgres (100)', () => {
  const sfx = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const bucket = (name: string) => `w2t_${sfx}_${name}`
  let pool: pg.Pool

  type RL = typeof import('@/lib/rate-limit')
  async function postgresInstance(): Promise<RL> {
    vi.resetModules()
    const rl = await import('@/lib/rate-limit')
    rl.__setRateLimitStoreForTests(null) // re-select from env on first call
    return rl
  }

  beforeAll(() => {
    vi.stubEnv('RATE_LIMIT_BACKEND', 'postgres')
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 25 })
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query(`DELETE FROM public.rate_limit_hits WHERE key LIKE $1`, [`w2t_${sfx}_%`])
    await pool.end()
  })

  it('50 concurrent hits on separate connections with max 10 → exactly 10 allowed', async () => {
    const key = `${bucket('sql')}:k`
    const rows = await Promise.all(
      Array.from({ length: 50 }, () =>
        pool.query<{ allowed: boolean; remaining: number; retry_after_seconds: number }>(
          `SELECT * FROM public.rate_limit_hit($1, 3600, 10)`, [key],
        ).then((r) => r.rows[0])),
    )
    expect(rows.filter((r) => r.allowed)).toHaveLength(10)
    for (const r of rows.filter((x) => !x.allowed)) {
      expect(r.remaining).toBe(0)
      expect(r.retry_after_seconds).toBeGreaterThan(0)
      expect(r.retry_after_seconds).toBeLessThanOrEqual(7200)
    }
    const { rows: stored } = await pool.query(`SELECT sum(count)::int AS n FROM public.rate_limit_hits WHERE key = $1`, [key])
    expect(stored[0].n).toBe(10) // denied hits are not counted
  })

  it('lib/rate-limit Postgres store: 50 parallel calls with max 10 → exactly 10 allowed', async () => {
    const rl = await postgresInstance()
    const results = await Promise.all(
      Array.from({ length: 50 }, () => rl.checkRateLimit('user-1', bucket('lib'), { max: 10, windowMs: 3_600_000 })),
    )
    expect(results.every((r) => r.backend === 'postgres')).toBe(true)
    expect(results.filter((r) => !r.limited)).toHaveLength(10)
    expect(results.filter((r) => r.limited).every((r) => r.reason === 'limit' && r.retryAfterSeconds > 0)).toBe(true)
  })

  it('two module instances (two serverless instances) share one limit', async () => {
    const a = await postgresInstance()
    const b = await postgresInstance()
    expect(a).not.toBe(b)
    const calls = Array.from({ length: 40 }, (_, i) =>
      (i % 2 ? a : b).isRateLimitedKey('attacker', bucket('cross'), { max: 10, windowMs: 3_600_000 }))
    const limited = await Promise.all(calls)
    expect(limited.filter((x) => !x)).toHaveLength(10)
  })

  it('stores only "<bucket>:<hmac>" — never the raw identifier', async () => {
    const rl = await postgresInstance()
    await rl.isRateLimitedKey('raw-user-id-77f1', bucket('hash'), { max: 5 })
    const { rows } = await pool.query(`SELECT key FROM public.rate_limit_hits WHERE key LIKE $1`, [`${bucket('hash')}:%`])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe(`${bucket('hash')}:${rl.hashIdentifier('raw-user-id-77f1')}`)
    expect(rows[0].key).not.toContain('raw-user-id')
  })

  it('sliding window: the previous window counts by its remaining overlap', async () => {
    const key = `${bucket('slide')}:k`
    const W = 604800 // a week: the weight barely moves while the test runs
    const PREV = 8
    const MAX = 10
    // The previous window holds 8 hits; it decays linearly over the current one.
    await pool.query(
      `INSERT INTO public.rate_limit_hits (key, window_seconds, window_start, count, expires_at)
       SELECT $1, $2::int, to_timestamp(floor(extract(epoch FROM now()) / $2::int) * $2::int - $2::int), $3::int, now() + interval '1 day'`,
      [key, W, PREV],
    )
    const elapsed = (Date.now() / 1000) % W
    const weight = 1 - elapsed / W
    const expectedAllowed = Math.floor(MAX - PREV * weight) // allowed while prev·w + cur + 1 ≤ max
    const rows = []
    for (let i = 0; i < 12; i++) {
      rows.push((await pool.query(`SELECT * FROM public.rate_limit_hit($1, $2, $3)`, [key, W, MAX])).rows[0])
    }
    expect(rows.filter((r) => r.allowed)).toHaveLength(expectedAllowed)
    const denied = rows.find((r) => !r.allowed)
    // Wait until prev·(1 − e/W) + cur + 1 ≤ max — or, when the current window
    // is already full, until it closes and decays as the next "previous" one.
    const expectedRetry = expectedAllowed < MAX
      ? W * (1 - (MAX - expectedAllowed - 1) / PREV) - elapsed
      : (W - elapsed) + W * (1 - (MAX - 1) / MAX)
    expect(Math.abs(denied.retry_after_seconds - Math.ceil(expectedRetry))).toBeLessThanOrEqual(2)
  })

  it('rejects invalid arguments', async () => {
    await expect(pool.query(`SELECT * FROM public.rate_limit_hit('', 60, 1)`)).rejects.toThrow(/invalid key/)
    await expect(pool.query(`SELECT * FROM public.rate_limit_hit('k', 0, 1)`)).rejects.toThrow(/invalid window/)
    await expect(pool.query(`SELECT * FROM public.rate_limit_hit('k', 60, 0)`)).rejects.toThrow(/invalid max/)
  })

  it('prune deletes expired rows only', async () => {
    const expired = `${bucket('prune')}:old`
    const live = `${bucket('prune')}:live`
    await pool.query(
      `INSERT INTO public.rate_limit_hits (key, window_seconds, window_start, count, expires_at) VALUES
         ($1, 60, now() - interval '10 minutes', 3, now() - interval '8 minutes'),
         ($2, 60, now(), 1, now() + interval '2 minutes')`,
      [expired, live],
    )
    const rl = await postgresInstance()
    expect(await rl.pruneRateLimits()).toBeGreaterThanOrEqual(1)
    const { rows } = await pool.query(`SELECT key FROM public.rate_limit_hits WHERE key = ANY($1)`, [[expired, live]])
    expect(rows.map((r) => r.key)).toEqual([live])
  })

  it('server only: RLS on, nothing granted to anon / authenticated', async () => {
    const { rows } = await pool.query(`
      SELECT c.relrowsecurity AS rls, c.relpersistence AS persistence,
             has_table_privilege('anon', 'public.rate_limit_hits', 'SELECT') AS anon_select,
             has_table_privilege('authenticated', 'public.rate_limit_hits', 'INSERT') AS auth_insert,
             has_function_privilege('anon', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') AS anon_hit,
             has_function_privilege('authenticated', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') AS auth_hit,
             has_function_privilege('authenticated', 'public.rate_limit_prune(integer)', 'EXECUTE') AS auth_prune,
             has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') AS service_hit,
             p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS config
        FROM pg_class c, pg_proc p
       WHERE c.oid = 'public.rate_limit_hits'::regclass
         AND p.oid = 'public.rate_limit_hit(text,integer,integer)'::regprocedure`)
    expect(rows[0]).toMatchObject({
      rls: true, persistence: 'u',
      anon_select: false, auth_insert: false, anon_hit: false, auth_hit: false, auth_prune: false,
      service_hit: true, definer: true,
    })
    expect(rows[0].config).toContain('search_path=pg_catalog, public')
  })
})
