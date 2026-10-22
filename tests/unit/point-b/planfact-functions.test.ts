/**
 * Point B Ф6b, Task 4: the Inngest handlers of the recompute and of the monthly reconciliation, replayed with a fake
 * `step` (no Inngest, no network): the schedule from the setting, the batch of at most 10 companies with a pause
 * between them and a continuation event, one step per company, the journal, the single-company run of the button,
 * the reconciliation of the month that ended (reminder by the client's settings, the expert's task).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pbDb } from './_pbdb'

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  gates: false,
  tier: 'pro',
  notify: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/access/server', () => ({ readEntitlements: async () => ({ tier: s.tier }) }))
vi.mock('@/lib/access/entitlements', () => ({ can: (e: { tier: string }) => e.tier === 'pro' }))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: Record<string, unknown>) => { s.notify.push(input); return { ok: true, delivered: { inApp: true, email: true, telegram: false } } },
}))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async () => ({ eventId: null, duplicate: false, deliveries: [] }) }))
vi.mock('@/lib/point-b/plan/notify', () => ({ POINT_B_STAFF_PERMISSION: 'clients.review', pointBStaffLink: (id: string) => `/u/${id}` }))
vi.mock('@/lib/inngest', () => ({ inngest: { createFunction: (cfg: unknown, fn: unknown) => ({ cfg, fn }) } }))

const fns = await import('@/lib/functions/point-b')
const { listPlanCompanies, monthlyReconciliation } = await import('@/lib/point-b/planfact/batch')

/** A fake step: runs every step at once and records what happened. */
function fakeStep() {
  const log: string[] = []
  const events: Array<{ name: string; data: Record<string, unknown> }> = []
  const step = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => { log.push(`run:${id}`); return fn() },
    sleep: async (id: string, d: string | number) => { log.push(`sleep:${id}:${d}`) },
    sendEvent: async (id: string, p: { name: string; data: Record<string, unknown> }) => { log.push(`send:${id}`); events.push(p) },
  }
  return { step, log, events }
}

const company = (n: number) => ({ companyId: `company-${String(n).padStart(2, '0')}`, userId: `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, '0')}` })
const MONDAY_22 = new Date('2026-10-19T22:00:00Z')
const journal = () => {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    start: vi.fn(async (_sb: unknown, input: Record<string, unknown>) => { calls.push(['start', input]); return 'run-1' }),
    finish: vi.fn(async (_sb: unknown, id: unknown, totals: unknown) => { calls.push(['finish', { id, totals }]) }),
  }
}

beforeEach(() => {
  s.h = pbDb()
  s.gates = false
  s.tier = 'pro'
  s.notify.length = 0
})

describe('pb-recompute (scheduled)', () => {
  it('outside the scheduled hours it reads nothing but the setting', async () => {
    const { step, log } = fakeStep()
    const list = vi.fn()
    const out = await fns.runScheduledRecompute({ event: { name: 'inngest/scheduled.timer' }, step }, { now: () => new Date('2026-10-20T22:00:00Z'), cron: async () => '0 22 * * 1,4', list })
    expect(out).toEqual({ skipped: 'not_due' })
    expect(list).not.toHaveBeenCalled()
    expect(log).toEqual(['run:start'])
  })

  it('in a scheduled hour: at most 10 companies, one step each, a pause between, the journal, a continuation event', async () => {
    const { step, log, events } = fakeStep()
    const j = journal()
    const recompute = vi.fn(async (c: { companyId: string }, _ctx: unknown) => ({ companyId: c.companyId, status: c.companyId === 'company-03' ? 'failed' as const : c.companyId === 'company-04' ? 'unchanged' as const : 'done' as const, error: 'boom' }))
    const list = vi.fn(async () => ({ companies: Array.from({ length: 10 }, (_, i) => company(i)), next: 'company-09' }))
    const out = await fns.runScheduledRecompute({ event: { name: 'inngest/scheduled.timer' }, step }, {
      now: () => MONDAY_22, cron: async () => '0 22 * * 1,4', tolerances: async () => ({ onTrackPct: 3, riskPct: 9 }), list, recompute, journal: j,
    })
    expect(out).toEqual({ companies: 10, done: 8, continued: true })
    expect(list).toHaveBeenCalledWith(expect.anything(), { after: null })
    expect(log.filter((l) => l.startsWith('run:company-'))).toHaveLength(10)
    expect(log.filter((l) => l.startsWith('sleep:'))).toHaveLength(9)
    expect(log.filter((l) => l.startsWith('sleep:'))[0]).toBe('sleep:pause-0:3s')
    expect(log.at(-2)).toBe('run:finish')
    expect(events).toEqual([{ name: fns.PB_RECOMPUTE_CONTINUE_EVENT, data: { cursor: 'company-09' } }])
    // every company got the same clock and the tolerances of the setting
    expect(recompute.mock.calls[0][1]).toEqual({ now: MONDAY_22, tolerances: { onTrackPct: 3, riskPct: 9 } })
    expect(j.calls[0]).toEqual(['start', { kind: 'scheduled', cursor: null, now: MONDAY_22 }])
    expect(j.calls[1][1]).toMatchObject({ id: 'run-1', totals: { companies: 8, skipped: 1, errors: [{ companyId: 'company-03', error: 'boom' }] } })
  })

  it('a continuation goes on from the cursor without asking the schedule; the last page sends nothing', async () => {
    const { step, events } = fakeStep()
    const cron = vi.fn(async () => '0 22 * * 1,4')
    const list = vi.fn(async () => ({ companies: [company(11)], next: null }))
    const out = await fns.runScheduledRecompute({ event: { name: fns.PB_RECOMPUTE_CONTINUE_EVENT, data: { cursor: 'company-09' } }, step }, {
      now: () => new Date('2026-10-20T03:00:00Z'), cron, list, recompute: async (c) => ({ companyId: c.companyId, status: 'done' }), journal: journal(), tolerances: async () => ({ onTrackPct: 5, riskPct: 15 }),
    })
    expect(out).toEqual({ companies: 1, done: 1, continued: false })
    expect(cron).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledWith(expect.anything(), { after: 'company-09' })
    expect(events).toEqual([])
  })

  it('nothing to do: no journal row, no steps per company', async () => {
    const { step, log } = fakeStep()
    const j = journal()
    await fns.runScheduledRecompute({ event: {}, step }, { now: () => MONDAY_22, cron: async () => '0 22 * * 1,4', list: async () => ({ companies: [], next: null }), journal: j, tolerances: async () => ({ onTrackPct: 5, riskPct: 15 }) })
    expect(j.start).not.toHaveBeenCalled()
    expect(log).toEqual(['run:start'])
  })

  it('the functions: an hourly cron + the continuation, a shared concurrency of 1, the button limited per company', () => {
    const cfg = (f: unknown) => (f as { cfg: Record<string, unknown> }).cfg
    expect(cfg(fns.pbRecompute)).toMatchObject({ id: 'pb-recompute', triggers: [{ cron: '0 * * * *' }, { event: 'point-b/recompute.continue' }] })
    expect(cfg(fns.pbRecompute).concurrency).toEqual([{ scope: 'env', key: '"pb-recompute"', limit: 1 }])
    expect(cfg(fns.pbRecomputeCompany)).toMatchObject({
      id: 'pb-recompute-company', triggers: [{ event: 'point-b/recompute.requested' }],
      rateLimit: { key: 'event.data.companyId', limit: 1, period: '10m' }, concurrency: [{ scope: 'env', key: '"pb-recompute"', limit: 1 }],
    })
    expect(cfg(fns.pbMonthlyCheckpoint)).toMatchObject({ id: 'pb-monthly-checkpoint', triggers: [{ cron: '0 4 1 * *' }, { event: 'point-b/monthly.continue' }] })
  })
})

describe('pb-recompute-company (the button as an event)', () => {
  it('one company, a manual journal row with who asked', async () => {
    const { step, log } = fakeStep()
    const j = journal()
    const out = await fns.runCompanyRecompute({ event: { data: { companyId: 'company-01', userId: company(1).userId, requestedBy: 'eeeeeeee-0000-4000-8000-000000000001' } }, step }, {
      now: () => MONDAY_22, recompute: async (c) => ({ companyId: c.companyId, status: 'done' }), journal: j, tolerances: async () => ({ onTrackPct: 5, riskPct: 15 }),
    })
    expect(out).toEqual({ companyId: 'company-01', status: 'done' })
    expect(log).toEqual(['run:start', 'run:company', 'run:finish'])
    expect(j.calls[0]).toEqual(['start', { kind: 'manual', companyId: 'company-01', triggeredBy: 'eeeeeeee-0000-4000-8000-000000000001', now: MONDAY_22 }])
  })

  it('an event without a company or with a bad user id does nothing', async () => {
    const { step, log } = fakeStep()
    expect(await fns.runCompanyRecompute({ event: { data: { companyId: 'company-01', userId: 'not-a-uuid' } }, step })).toEqual({ skipped: 'bad_event' })
    expect(await fns.runCompanyRecompute({ event: { data: {} }, step })).toEqual({ skipped: 'bad_event' })
    expect(log).toEqual([])
  })
})

describe('the plan companies and the monthly reconciliation', () => {
  it('lists published plans only, by company id, at most 10 with a cursor', async () => {
    s.h = pbDb({
      pb_plans: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, company_id: company(i).companyId, user_id: company(i).userId, published_version_id: i === 5 ? null : `v${i}` })),
    })
    const first = await listPlanCompanies(s.h.sb, { after: null })
    expect(first.companies).toHaveLength(10)
    expect(first.companies.map((c) => c.companyId)).not.toContain('company-05')
    expect(first.next).toBe('company-10')
    const second = await listPlanCompanies(s.h.sb, { after: first.next })
    expect(second).toEqual({ companies: [company(11)], next: null })
    expect((await listPlanCompanies(s.h.sb, { after: null, limit: 50 })).companies).toHaveLength(10) // never more than 10
  })

  it('reminds the client through his notification settings and gives the assigned expert a task, once per month', async () => {
    const c = company(1)
    s.h = pbDb({ user_assignments: [{ user_id: c.userId, assignee_id: 'eeeeeeee-0000-4000-8000-000000000001' }], staff_tasks: [] })
    const now = new Date('2026-11-01T04:00:00Z')
    const r = await monthlyReconciliation(s.h.sb, { ...c, period: '2026-10', now })
    expect(r).toEqual({ companyId: c.companyId, reminded: true, task: 'created', filled: false })
    expect(s.notify).toHaveLength(1)
    expect(s.notify[0]).toMatchObject({
      userId: c.userId, category: 'reminders', event: 'pb_monthly_reconciliation', ctaUrl: '/client/point-b?tab=history',
      dedupeKey: `pb_reconciliation:${c.userId}:2026-10`, automated: { kind: 'pb_monthly_reconciliation', countsTowardCap: false },
    })
    expect(s.notify[0]).not.toHaveProperty('channels') // the client's own settings decide
    expect(s.h.db.staff_tasks).toEqual([expect.objectContaining({ user_id: c.userId, assignee_id: 'eeeeeeee-0000-4000-8000-000000000001', title: 'Точка Б: проверить сверку за октябрь 2026', due_at: '2026-11-08T04:00:00.000Z' })])
    // the second pass of the month does not add a second task
    expect((await monthlyReconciliation(s.h.sb, { ...c, period: '2026-10', now })).task).toBe('exists')
    expect(s.h.db.staff_tasks).toHaveLength(1)
  })

  it('a month already filled is not asked again; a client without Point B is skipped; no assignee — no task', async () => {
    const c = company(2)
    s.h = pbDb({ pb_monthly_facts: [{ company_id: c.companyId, period: '2026-10', metric: 'revenue', value: 1 }], staff_tasks: [] })
    const now = new Date('2026-11-01T04:00:00Z')
    expect(await monthlyReconciliation(s.h.sb, { ...c, period: '2026-10', now })).toEqual({ companyId: c.companyId, reminded: false, task: 'no_assignee', filled: true })
    expect(s.notify).toEqual([])
    s.gates = true
    s.tier = 'free'
    expect((await monthlyReconciliation(s.h.sb, { ...c, period: '2026-10', now })).skipped).toBe('no_point_b')
  })

  it('pb-monthly-checkpoint: the month that ended, a pause between companies, the period carried by the continuation', async () => {
    const { step, log, events } = fakeStep()
    const reconcile = vi.fn(async (c: { companyId: string }) => ({ companyId: c.companyId, reminded: true, task: 'created' as const, filled: false }))
    const out = await fns.runMonthlyReconciliation({ event: { name: 'inngest/scheduled.timer' }, step }, {
      now: () => new Date('2026-11-01T04:00:00Z'), list: async () => ({ companies: [company(1), company(2)], next: 'company-02' }), reconcile,
    })
    expect(out).toEqual({ period: '2026-10', companies: 2, reminded: 2, continued: true })
    expect(log).toEqual(['run:start', 'run:company-0', 'sleep:pause-0:3s', 'run:company-1', 'send:continue'])
    expect(events).toEqual([{ name: fns.PB_MONTHLY_CONTINUE_EVENT, data: { cursor: 'company-02', period: '2026-10' } }])
    // a continuation on the 2nd keeps the period of the pass
    const again = fakeStep()
    const out2 = await fns.runMonthlyReconciliation({ event: { name: fns.PB_MONTHLY_CONTINUE_EVENT, data: { cursor: 'company-02', period: '2026-10' } }, step: again.step }, {
      now: () => new Date('2026-11-02T00:00:00Z'), list: async () => ({ companies: [company(3)], next: null }), reconcile,
    })
    expect(out2).toMatchObject({ period: '2026-10', continued: false })
  })
})
