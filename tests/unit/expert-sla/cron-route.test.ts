/**
 * GET /api/cron/expert-sla — проход SLA экспертов из планировщика портала (lib/cron/schedule.ts).
 * Inngest Cloud на Railway портал не вызывает, поэтому SLA запускается только отсюда: маршрут
 * пускает лишь крон с секретом, зовёт runExpertSla с бюджетом 30 с и функция снята с Inngest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const deps = vi.hoisted(() => ({ run: vi.fn(), sb: { tag: 'service-client' } }))

describe('GET /api/cron/expert-sla', () => {
  const SECRET = 'cron-secret-for-tests'
  const saved = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    deps.run.mockReset()
    vi.resetModules()
    vi.doMock('@/lib/expert-sla/run', () => ({ runExpertSla: deps.run, SLA_RUN_BUDGET_MS: 30_000 }))
    vi.doMock('@/lib/supabase-service', () => ({ createServiceClient: () => deps.sb }))
  })
  afterEach(() => {
    vi.doUnmock('@/lib/expert-sla/run')
    vi.doUnmock('@/lib/supabase-service')
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })
  const call = async (auth?: string) => {
    const { GET } = await import('@/app/api/cron/expert-sla/route')
    return GET(new NextRequest('http://localhost/api/cron/expert-sla', { headers: auth ? { authorization: auth } : {} }))
  }

  it('refuses calls without the secret and fails closed when it is not configured', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503)
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('runs one SLA pass with the service client and the 30 s budget, and returns its report', async () => {
    deps.run.mockResolvedValue({ enabled: true, created: 2, autoAssigned: 1, escalated: 0, breached: 0 })
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, enabled: true, created: 2, autoAssigned: 1, escalated: 0, breached: 0 })
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.run).toHaveBeenCalledWith({ sb: deps.sb, budgetMs: 30_000 })
  })

  it('a failed pass is a plain 500 without details', async () => {
    deps.run.mockRejectedValue(new Error('relation "expert_sla_tasks" does not exist'))
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'Internal server error' })
  })
})

describe('one source of the SLA pass', () => {
  it('the portal scheduler runs it every 5 minutes on the web process; Inngest does not serve it', async () => {
    const { CRON_JOBS, jobsForRole } = await import('@/lib/cron/schedule')
    expect(CRON_JOBS).toContainEqual({ path: '/api/cron/expert-sla', schedule: '*/5 * * * *' })
    expect(jobsForRole('web').map((j) => j.path)).toContain('/api/cron/expert-sla')
    expect(jobsForRole('all').map((j) => j.path)).toContain('/api/cron/expert-sla')
    expect(jobsForRole('agents').map((j) => j.path)).not.toContain('/api/cron/expert-sla')
    const { inngestFunctionsForRole } = await import('@/lib/functions/registry')
    const ids = inngestFunctionsForRole('all').map((fn) => (fn as unknown as { id: (p?: string) => string }).id())
    expect(ids.some((id) => id.includes('expert-sla'))).toBe(false)
  })
})
