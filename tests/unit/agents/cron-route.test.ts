/**
 * GET /api/cron/agents — the maintenance of the agent queue, by the role of the process
 * (PORTAL_ROLE, lib/runtime/role.ts):
 *   - one process for everything (the default): any scheduler may call it, every call does the full
 *     upkeep with the long budgets, exactly as before;
 *   - the web role: nothing is drained here;
 *   - the agents role: it is the service's only maintenance loop (no Inngest there), called every
 *     minute by the in-process cron, so it does what the Inngest cron `agents-maintenance` does.
 * In every role one drain runs at a time. All the work is a stub; nothing touches a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const work = vi.hoisted(() => ({
  scheduledAgentsOn: vi.fn(),
  enqueueScheduledAgents: vi.fn(),
  redispatchPending: vi.fn(),
  drainWhatsAppOutbox: vi.fn(),
  drainPointARecalc: vi.fn(),
  drainQueue: vi.fn(),
  pruneRateLimits: vi.fn(),
}))
vi.mock('@/lib/functions/agents', () => ({
  scheduledAgentsOn: work.scheduledAgentsOn,
  enqueueScheduledAgents: work.enqueueScheduledAgents,
}))
vi.mock('@/lib/events/platform', () => ({ redispatchPending: work.redispatchPending }))
vi.mock('@/lib/whatsapp/outbox', () => ({ drainWhatsAppOutbox: work.drainWhatsAppOutbox }))
vi.mock('@/lib/point-a/recalc-queue', () => ({ drainPointARecalc: work.drainPointARecalc }))
vi.mock('@/lib/agents/queue', () => ({ drainQueue: work.drainQueue }))
vi.mock('@/lib/rate-limit', () => ({ pruneRateLimits: work.pruneRateLimits }))

const SECRET = 'cron-secret-for-tests'
const WHATSAPP = { claimed: 2, sent: 2, retried: 0, deferred: 0, failed: 0, unknown: 0, skipped: 0, viaBridge: 0 }
const EMPTY_DRAIN = { reaped: 0, approvalsExpired: 0, sessionsFailed: 0, executed: [] }

type Handler = (req: NextRequest) => Promise<Response>
let GET: Handler

const request = (auth: string | null = `Bearer ${SECRET}`) =>
  new NextRequest('http://localhost/api/cron/agents', { headers: auth ? { authorization: auth } : {} })
const call = (auth?: string | null) => GET(request(auth))
const bodyOf = async (res: Response | Promise<Response>) => (await res).json()
/** Lets a call that was started and not awaited run up to its next unresolved await (the timers are fake). */
const tick = () => vi.advanceTimersByTimeAsync(0)
const calls = () => Object.fromEntries(Object.entries(work).map(([name, fn]) => [name, fn.mock.calls.length]))
const NOTHING = { scheduledAgentsOn: 0, enqueueScheduledAgents: 0, redispatchPending: 0, drainWhatsAppOutbox: 0, drainPointARecalc: 0, drainQueue: 0, pruneRateLimits: 0 }

function gate<T>(value: T) {
  let open!: () => void
  const promise = new Promise<T>((resolve) => { open = () => resolve(value) })
  return { promise, open }
}

beforeEach(async () => {
  for (const fn of Object.values(work)) fn.mockReset()
  work.scheduledAgentsOn.mockResolvedValue(false)
  work.enqueueScheduledAgents.mockResolvedValue([])
  work.redispatchPending.mockResolvedValue(0)
  work.drainWhatsAppOutbox.mockResolvedValue(WHATSAPP)
  work.drainPointARecalc.mockResolvedValue({ done: [], failed: [] })
  work.drainQueue.mockResolvedValue(EMPTY_DRAIN)
  work.pruneRateLimits.mockResolvedValue(0)
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('PORTAL_ROLE', '')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T10:07:20Z')) // not a quarter of an hour
  // The single-flight flag is module state: every test gets its own copy of the route.
  vi.resetModules()
  GET = (await import('@/app/api/cron/agents/route')).GET as Handler
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/cron/agents: authorisation', () => {
  it('refuses a call without the secret, and fails closed when CRON_SECRET is not configured', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    expect((await call(SECRET)).status).toBe(401) // the bare secret is not a bearer token

    vi.stubEnv('CRON_SECRET', '')
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'CRON_SECRET не настроен' })
    expect(calls()).toEqual(NOTHING)
  })

  it('asks for the secret in every role, before it says anything else', async () => {
    for (const role of ['', 'web', 'agents']) {
      vi.stubEnv('PORTAL_ROLE', role)
      const res = await call('Bearer wrong')
      expect(res.status, `role=${role}`).toBe(401)
      expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    }
    expect(calls()).toEqual(NOTHING)
  })
})

describe('GET /api/cron/agents: one process for everything (PORTAL_ROLE unset) - as before', () => {
  it('every call does the full upkeep with the long budgets, whatever the minute and the 24/7 switch', async () => {
    work.redispatchPending.mockResolvedValue(3)
    work.drainPointARecalc.mockResolvedValue({ done: [{ companyId: 'c1', status: 'ok' }], failed: [] })
    work.drainQueue.mockResolvedValue({
      reaped: 1,
      approvalsExpired: 2,
      sessionsFailed: 0,
      executed: [{ taskId: 't1', runId: 'r1', finalStatus: 'succeeded', summary: 'private summary', errorCode: null }],
    })
    work.pruneRateLimits.mockResolvedValue(7)

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      scheduled: [],
      redispatched: 3,
      reaped: 1,
      approvalsExpired: 2,
      sessionsFailed: 0,
      rateLimitsPruned: 7,
      whatsapp: WHATSAPP,
      pointA: { done: 1, failed: 0 },
      executed: [{ taskId: 't1', status: 'succeeded', errorCode: null }],
    })
    expect(work.enqueueScheduledAgents).not.toHaveBeenCalled() // «Агенты по расписанию (24/7)» is off
    expect(work.drainWhatsAppOutbox).toHaveBeenCalledWith({ limit: 50, budgetMs: 30_000 })
    expect(work.drainPointARecalc).toHaveBeenCalledWith({ budgetMs: 60_000 })
    expect(work.drainQueue).toHaveBeenCalledWith({ budgetMs: 180_000 })
    expect(calls()).toEqual({ ...NOTHING, scheduledAgentsOn: 1, redispatchPending: 1, drainWhatsAppOutbox: 1, drainPointARecalc: 1, drainQueue: 1, pruneRateLimits: 1 })
  })

  it('an unknown PORTAL_ROLE is one process for everything too', async () => {
    vi.stubEnv('PORTAL_ROLE', 'worker')
    expect((await bodyOf(call())).ok).toBe(true)
    expect(work.drainQueue).toHaveBeenCalledWith({ budgetMs: 180_000 })
  })

  it('with the 24/7 switch on, scheduled agents are enqueued for the moment of the call', async () => {
    work.scheduledAgentsOn.mockResolvedValue(true)
    work.enqueueScheduledAgents.mockResolvedValue(['monitoring'])

    const body = await bodyOf(call())

    expect(body.scheduled).toEqual(['monitoring'])
    expect(work.enqueueScheduledAgents).toHaveBeenCalledTimes(1)
    expect(work.enqueueScheduledAgents).toHaveBeenCalledWith(new Date('2026-11-10T10:07:20Z'))
  })

  it('works in this order: scheduled agents, stuck events, WhatsApp outbox, Point A, the queue, rate-limit rows', async () => {
    const order: string[] = []
    const results: Record<keyof typeof work, unknown> = {
      scheduledAgentsOn: true,
      enqueueScheduledAgents: [],
      redispatchPending: 0,
      drainWhatsAppOutbox: WHATSAPP,
      drainPointARecalc: { done: [], failed: [] },
      drainQueue: EMPTY_DRAIN,
      pruneRateLimits: 0,
    }
    for (const name of Object.keys(work) as (keyof typeof work)[]) {
      work[name].mockImplementation(async () => { order.push(name); return results[name] })
    }

    await call()

    expect(order).toEqual(['scheduledAgentsOn', 'enqueueScheduledAgents', 'redispatchPending', 'drainWhatsAppOutbox', 'drainPointARecalc', 'drainQueue', 'pruneRateLimits'])
  })

  it('a WhatsApp or Point A drain that fails is logged by its first line and does not fail the call', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    work.drainWhatsAppOutbox.mockRejectedValue(new Error('outbox down\nwith a stack that names a table'))
    work.drainPointARecalc.mockRejectedValue(new Error('point A down\nsecond line'))

    const res = await call()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, whatsapp: null, pointA: null })
    expect(work.drainQueue).toHaveBeenCalledTimes(1)
    expect(error.mock.calls.map((args) => args.join(' '))).toEqual([
      '[cron/agents] whatsapp drain failed outbox down',
      '[cron/agents] point A drain failed point A down',
    ])
  })

  it('a queue drain that fails answers 500 with the Russian message, and the next call drains again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    work.drainQueue.mockRejectedValueOnce(new Error('connection refused'))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'Сбой обслуживания очереди агентов' })
    expect(error).toHaveBeenCalledWith('[cron/agents] failed', 'connection refused')

    const again = await call()
    expect(again.status).toBe(200)
    expect((await again.json()).ok).toBe(true)
    expect(work.drainQueue).toHaveBeenCalledTimes(2)
  })
})

describe('GET /api/cron/agents: the web role drains nothing', () => {
  it('an authorised call answers 200 { ok: true, skipped: "not_agents_role" } and nothing is touched', async () => {
    vi.stubEnv('PORTAL_ROLE', 'web')

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, skipped: 'not_agents_role' })
    expect(calls()).toEqual(NOTHING) // not even the settings are read
  })

  it('reads the role on every call, in any spelling', async () => {
    vi.stubEnv('PORTAL_ROLE', ' WEB ')
    expect(await bodyOf(call())).toEqual({ ok: true, skipped: 'not_agents_role' })
    vi.stubEnv('PORTAL_ROLE', '')
    expect((await bodyOf(call())).skipped).toBeUndefined()
    expect(work.drainQueue).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/cron/agents: one drain at a time', () => {
  it('while one call is draining, another authorised call answers 200 { ok: true, skipped: "busy" } at once', async () => {
    const drain = gate(EMPTY_DRAIN)
    work.drainQueue.mockReturnValueOnce(drain.promise)

    const first = call()
    await tick()
    expect(work.drainQueue).toHaveBeenCalledTimes(1)
    const during = calls()

    const second = await call()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, skipped: 'busy' })
    expect(calls()).toEqual(during) // the busy call read and drained nothing

    drain.open()
    expect((await bodyOf(first)).ok).toBe(true)

    // the route is free again
    expect((await bodyOf(call())).skipped).toBeUndefined()
    expect(work.drainQueue).toHaveBeenCalledTimes(2)
  })

  it('busy from the very first step of the call that is running', async () => {
    const setting = gate(false)
    work.scheduledAgentsOn.mockReturnValueOnce(setting.promise)

    const first = call()
    await tick()
    expect(await bodyOf(call())).toEqual({ ok: true, skipped: 'busy' })
    expect(work.scheduledAgentsOn).toHaveBeenCalledTimes(1)

    setting.open()
    expect((await bodyOf(first)).ok).toBe(true)
  })

  it('a call without the secret is refused during a drain as well, it is not told that the route is busy', async () => {
    const drain = gate(EMPTY_DRAIN)
    work.drainQueue.mockReturnValueOnce(drain.promise)
    const first = call()
    await tick()

    const res = await call('Bearer wrong')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })

    drain.open()
    await first
  })

  it('a drain that never comes back does not block the route for ever: after 10 minutes the next call takes over', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    work.drainQueue.mockReturnValueOnce(new Promise(() => {})) // a query on a dead connection

    void call()
    await tick()

    vi.setSystemTime(new Date('2026-11-10T10:17:19Z')) // 9 min 59 s later
    expect(await bodyOf(call())).toEqual({ ok: true, skipped: 'busy' })
    expect(error).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-11-10T10:17:20Z')) // 10 min later
    const body = await bodyOf(call())
    expect(body.ok).toBe(true)
    expect(body.skipped).toBeUndefined()
    expect(work.drainQueue).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toMatch(/\[cron\/agents\].*10 min/)
  })

  it('the late end of a drain that was given up on does not free the route under the one that replaced it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stuck = gate(EMPTY_DRAIN)
    const replacement = gate(EMPTY_DRAIN)
    work.drainQueue.mockReturnValueOnce(stuck.promise).mockReturnValueOnce(replacement.promise)

    const first = call()
    await tick()
    vi.setSystemTime(new Date('2026-11-10T10:18:00Z'))
    const second = call() // takes over
    await tick()
    expect(work.drainQueue).toHaveBeenCalledTimes(2)

    stuck.open() // the first one comes back after all
    await first
    expect(await bodyOf(call())).toEqual({ ok: true, skipped: 'busy' }) // the second is still draining

    replacement.open()
    await second
    expect((await bodyOf(call())).skipped).toBeUndefined()
  })
})

describe('GET /api/cron/agents: the agents role - the maintenance loop of the agents service', () => {
  beforeEach(() => {
    vi.stubEnv('PORTAL_ROLE', 'agents')
  })

  it('24/7 switch off (the default), not a quarter of an hour: quiet mode, only the switch is read', async () => {
    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, skipped: 'quiet_mode' })
    expect(calls()).toEqual({ ...NOTHING, scheduledAgentsOn: 1 })
  })

  it('24/7 switch off: the upkeep runs in minutes 00, 15, 30 and 45 (UTC) and in no other', async () => {
    const ran: number[] = []
    for (let minute = 0; minute < 60; minute += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 10, minute, 30)))
      const body = await bodyOf(call())
      if (body.skipped === undefined) ran.push(minute)
      else expect(body).toEqual({ ok: true, skipped: 'quiet_mode' })
    }
    expect(ran).toEqual([0, 15, 30, 45])
    expect(work.drainQueue).toHaveBeenCalledTimes(4)
    expect(work.enqueueScheduledAgents).not.toHaveBeenCalled() // no scheduled agents while the switch is off
  })

  it('24/7 switch on: every minute runs, and the scheduled agents get the minute of the call', async () => {
    work.scheduledAgentsOn.mockResolvedValue(true)
    work.enqueueScheduledAgents.mockResolvedValue(['integration_sync'])

    const body = await bodyOf(call())

    expect(body).toMatchObject({ ok: true, scheduled: ['integration_sync'] })
    expect(work.enqueueScheduledAgents).toHaveBeenCalledWith(new Date('2026-11-10T10:07:20Z'))
    expect(work.drainQueue).toHaveBeenCalledTimes(1)
  })

  it('the clock is read once, at the start: a slow settings read does not move the call into the next minute', async () => {
    work.scheduledAgentsOn.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-11-10T10:08:03Z'))
      return true
    })

    await call()

    expect(work.enqueueScheduledAgents).toHaveBeenCalledWith(new Date('2026-11-10T10:07:20Z'))
  })

  it('a run every minute must end within the minute: the budgets of the Inngest maintenance, 10 s + 15 s + 20 s', async () => {
    work.scheduledAgentsOn.mockResolvedValue(true)

    await call()

    expect(work.drainWhatsAppOutbox).toHaveBeenCalledWith({ limit: 50, budgetMs: 10_000 })
    expect(work.drainPointARecalc).toHaveBeenCalledWith({ budgetMs: 15_000 })
    expect(work.drainQueue).toHaveBeenCalledWith({ budgetMs: 20_000 })
  })

  it('keeps what the route always did on top of the Inngest maintenance: the rate-limit rows and the full report', async () => {
    vi.setSystemTime(new Date('2026-11-10T10:15:00Z'))
    work.pruneRateLimits.mockResolvedValue(4)
    work.drainQueue.mockResolvedValue({
      reaped: 2,
      approvalsExpired: 0,
      sessionsFailed: 1,
      executed: [{ taskId: 't9', runId: null, finalStatus: 'dead', summary: null, errorCode: 'BUDGET_EXCEEDED' }],
    })

    expect(await bodyOf(call())).toEqual({
      ok: true,
      scheduled: [],
      redispatched: 0,
      reaped: 2,
      approvalsExpired: 0,
      sessionsFailed: 1,
      rateLimitsPruned: 4,
      whatsapp: WHATSAPP,
      pointA: { done: 0, failed: 0 },
      executed: [{ taskId: 't9', status: 'dead', errorCode: 'BUDGET_EXCEEDED' }],
    })
  })

  it('a quiet minute leaves the route free for the next call', async () => {
    expect(await bodyOf(call())).toEqual({ ok: true, skipped: 'quiet_mode' })
    vi.setSystemTime(new Date('2026-11-10T10:15:00Z'))
    expect((await bodyOf(call())).skipped).toBeUndefined()
  })

  it('a minute that arrives while the previous drain is still running is busy, not quiet', async () => {
    work.scheduledAgentsOn.mockResolvedValue(true)
    const drain = gate(EMPTY_DRAIN)
    work.drainQueue.mockReturnValueOnce(drain.promise)
    const first = call()
    await tick()

    vi.setSystemTime(new Date('2026-11-10T10:08:00Z'))
    expect(await bodyOf(call())).toEqual({ ok: true, skipped: 'busy' })

    drain.open()
    await first
  })

  it('a failure before the quiet-mode decision answers 500 and leaves the route free', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    work.scheduledAgentsOn.mockRejectedValueOnce(new Error('settings table missing'))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'Сбой обслуживания очереди агентов' })
    expect(error).toHaveBeenCalledWith('[cron/agents] failed', 'settings table missing')

    vi.setSystemTime(new Date('2026-11-10T10:15:00Z'))
    expect((await bodyOf(call())).ok).toBe(true)
  })
})
