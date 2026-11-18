/**
 * GET /api/cron/crm-sync — only the scheduler's bearer secret; 200 with the run's counts even when
 * single connections failed (each has its own status); 500 only when the run itself failed; the
 * error hook of a failed connection emits INTEGRATION_FAILED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  run: vi.fn(),
  emitted: [] as Array<{ id: string; message: string }>,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ service: true }) }))
vi.mock('@/lib/crm/sync-cron', () => ({ runCrmAutoSync: h.run }))
vi.mock('@/lib/crm/sync-events', () => ({ emitCrmSyncFailed: (conn: { id: string }, message: string) => h.emitted.push({ id: conn.id, message }) }))

const { GET } = await import('@/app/api/cron/crm-sync/route')
const req = (auth?: string) => new NextRequest('http://portal.test/api/cron/crm-sync', { headers: auth ? { authorization: auth } : {} })

let saved: string | undefined
beforeEach(() => {
  saved = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'cron-test-secret'
  h.run.mockReset()
  h.emitted.length = 0
})
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = saved
})

describe('GET /api/cron/crm-sync', () => {
  it('refuses without the secret (401), with a wrong one (401), and when none is configured (503)', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer cron-test-secret'))).status).toBe(503)
    expect(h.run).not.toHaveBeenCalled()
  })

  it('runs the auto sync with the service client and answers 200 with its counts', async () => {
    h.run.mockImplementation(async (deps: { sb: unknown; onError: (c: { id: string }, m: string) => void }) => {
      expect(deps.sb).toEqual({ service: true })
      deps.onError({ id: 'c9' }, 'CRM отклонила доступ')
      return { due: 3, started: 3, success: 1, partial: 1, error: 1, deferred: 0, elapsedMs: 1200 }
    })
    const res = await GET(req('Bearer cron-test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, due: 3, started: 3, success: 1, partial: 1, error: 1, deferred: 0, elapsedMs: 1200 })
    expect(h.emitted).toEqual([{ id: 'c9', message: 'CRM отклонила доступ' }])
  })

  it('500 when the due connections cannot be read', async () => {
    h.run.mockRejectedValue(new Error('crm-sync: due connections not read'))
    expect((await GET(req('Bearer cron-test-secret'))).status).toBe(500)
  })
})
