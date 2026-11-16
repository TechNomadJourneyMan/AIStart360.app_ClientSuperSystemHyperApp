/**
 * GET /api/cron/ops-watchdog (R4-A1): the bearer CRON_SECRET only; the report of the pass; and when
 * an alert could not be sent (NV-4) the pass is done but the answer is 502 «alerts_not_delivered»,
 * so the scheduler journals the run as an error and GIGA shows «тревоги не доставлены».
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ report: {} as Record<string, unknown>, throws: null as Error | null }))
vi.mock('@/lib/ops/job-watchdog', () => ({
  WATCHDOG_UNDELIVERED_HTTP: 502,
  runJobWatchdog: async () => {
    if (h.throws) throw h.throws
    return h.report
  },
}))

import { GET } from '@/app/api/cron/ops-watchdog/route'

const call = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/ops-watchdog', { headers: auth ? { authorization: auth } : {} }))
const base = { journal: 'ok', problems: [], notified: [], undelivered: [], failedChecks: [], pruned: { jobRuns: 0, cronRuns: 0 } }

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  h.throws = null
  h.report = { status: 'ok', ...base }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/ops-watchdog', () => {
  it('only with the bearer secret', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer cron-secret')).status).toBe(503)
  })

  it('a pass that is fine, or that alerted, is 200 with the report', async () => {
    let res = await call('Bearer cron-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'ok' })
    h.report = { ...base, status: 'alerted', problems: ['demo:burst'], notified: ['demo:burst'] }
    res = await call('Bearer cron-secret')
    expect(res.status).toBe(200)
  })

  it('alerts that could not be sent: 502 «alerts_not_delivered» with the report (NV-4)', async () => {
    h.report = { ...base, status: 'undelivered', problems: ['pa_queue:overdue'], undelivered: ['pa_queue:overdue'], failedChecks: ['notify:pa_queue:overdue'] }
    const res = await call('Bearer cron-secret')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false, error: 'alerts_not_delivered', undelivered: ['pa_queue:overdue'] })
  })

  it('a pass that throws is 500 without details', async () => {
    h.throws = new Error("Can't reach database server at db.internal:5432")
    const res = await call('Bearer cron-secret')
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('db.internal')
  })
})
