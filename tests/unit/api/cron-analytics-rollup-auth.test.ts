/** R-231 — /api/cron/analytics-rollup uses the shared isAuthorizedCron: 503 without a secret, 401 on a bad one. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({ runs: 0 }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/analytics/rollup', () => ({
  runDailyRollup: async () => { s.runs++; return { ok: true, planned: 1, rolled: [{ day: '2026-11-13' }], failed: [], stoppedEarly: false } },
}))

const { GET } = await import('@/app/api/cron/analytics-rollup/route')
const call = (auth?: string) => GET(new NextRequest('http://x/api/cron/analytics-rollup', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => { s.runs = 0 })
afterEach(() => vi.unstubAllEnvs())

describe('R-231 analytics-rollup cron auth', () => {
  it('R-231: no CRON_SECRET → 503 (like every other cron), nothing runs', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await call('Bearer anything')
    expect(res.status).toBe(503)
    expect(s.runs).toBe(0)
  })

  it('R-231: wrong or missing bearer → 401', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-123')
    expect((await call('Bearer nope')).status).toBe(401)
    expect((await call()).status).toBe(401)
    expect(s.runs).toBe(0)
  })

  it('R-231: the right bearer runs the rollup', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-123')
    const res = await call('Bearer cron-secret-123')
    expect(res.status).toBe(200)
    expect(s.runs).toBe(1)
  })
})
