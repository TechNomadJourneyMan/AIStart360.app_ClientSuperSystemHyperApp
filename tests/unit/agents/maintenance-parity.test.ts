/**
 * The agents service (PORTAL_ROLE=agents) has no Inngest: GET /api/cron/agents, called every minute
 * by its in-process cron, stands in for the Inngest cron `agents-maintenance`
 * (lib/functions/agents.ts). The two live in different files, so this test runs both against the
 * same stubs and compares what they do, call for call. Whoever changes one of them (a budget, the
 * order, the quiet mode) is told here to change the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const shared = vi.hoisted(() => ({
  /** Every call to a stub, in order: [name, ...arguments]. */
  log: [] as unknown[][],
  scheduledOn: false,
}))
vi.mock('@/lib/agents/queue', () => ({
  AGENT_TASK_REQUESTED_EVENT: 'agents/task.requested',
  drainQueue: async (...args: unknown[]) => {
    shared.log.push(['drainQueue', ...args])
    return { reaped: 1, approvalsExpired: 2, sessionsFailed: 3, executed: [{ taskId: 't1', runId: 'r1', finalStatus: 'succeeded', summary: null, errorCode: null }] }
  },
  enqueueAgentTask: async (...args: unknown[]) => {
    shared.log.push(['enqueueAgentTask', ...args])
    return { id: 'task-1', created: true }
  },
  executeTaskById: async () => null,
}))
vi.mock('@/lib/agents/registry', () => ({
  listAgents: () => [
    { key: 'every_minute', scope: 'platform', triggers: { cron: '* * * * *' } },
    { key: 'quarterly', scope: 'platform', triggers: { cron: '*/15 * * * *' } },
    { key: 'per_company', scope: 'company', triggers: { cron: '* * * * *' } },
  ],
}))
vi.mock('@/lib/agents/store', () => ({ loadConfig: async () => null }))
vi.mock('@/lib/settings/store', () => ({
  getSetting: async (...args: unknown[]) => {
    shared.log.push(['getSetting', ...args])
    return shared.scheduledOn
  },
}))
vi.mock('@/lib/events/platform', () => ({
  redispatchPending: async (...args: unknown[]) => {
    shared.log.push(['redispatchPending', ...args])
    return 4
  },
}))
vi.mock('@/lib/whatsapp/outbox', () => ({
  drainWhatsAppOutbox: async (...args: unknown[]) => {
    shared.log.push(['drainWhatsAppOutbox', ...args])
    return { claimed: 0, sent: 0, retried: 0, deferred: 0, failed: 0, unknown: 0, skipped: 0, viaBridge: 0 }
  },
}))
vi.mock('@/lib/point-a/recalc-queue', () => ({
  drainPointARecalc: async (...args: unknown[]) => {
    shared.log.push(['drainPointARecalc', ...args])
    return { done: [], failed: [] }
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  pruneRateLimits: async (...args: unknown[]) => {
    shared.log.push(['pruneRateLimits', ...args])
    return 0
  },
}))

import { GET } from '@/app/api/cron/agents/route'
import { CRON_JOBS } from '@/lib/cron/schedule'
import { agentsMaintenance } from '@/lib/functions/agents'

const SECRET = 'cron-secret-for-tests'
const inngest = agentsMaintenance as unknown as {
  fn: () => Promise<Record<string, unknown>>
  opts: { concurrency?: unknown; triggers?: unknown[] }
}

/** What the Inngest function does at this moment. */
async function runInngest() {
  shared.log.length = 0
  const result = await inngest.fn()
  return { calls: shared.log.map((entry) => [...entry]), result }
}

/** What the route does at this moment on the agents service. */
async function runRoute() {
  shared.log.length = 0
  const res = await GET(new NextRequest('http://localhost/api/cron/agents', { headers: { authorization: `Bearer ${SECRET}` } }))
  return { calls: shared.log.map((entry) => [...entry]), status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  shared.scheduledOn = false
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('PORTAL_ROLE', 'agents')
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('GET /api/cron/agents on the agents service does what the Inngest cron agents-maintenance does', () => {
  const CASES = [
    { name: '24/7 switch off, an ordinary minute: both stay quiet', on: false, at: '2026-11-10T10:07:20Z', quiet: true },
    { name: '24/7 switch off, a quarter of an hour: both do the upkeep, no scheduled agents', on: false, at: '2026-11-10T10:15:05Z', quiet: false },
    { name: '24/7 switch on, an ordinary minute: both run, the every-minute agent is enqueued', on: true, at: '2026-11-10T10:07:20Z', quiet: false },
    { name: '24/7 switch on, a quarter of an hour: both run, both scheduled agents are enqueued', on: true, at: '2026-11-10T10:30:59Z', quiet: false },
  ]

  for (const c of CASES) {
    it(c.name, async () => {
      shared.scheduledOn = c.on
      vi.setSystemTime(new Date(c.at))

      const viaInngest = await runInngest()
      const viaRoute = await runRoute()

      // call for call, argument for argument; on top of it the route prunes the rate-limit rows
      expect(viaRoute.calls.filter(([name]) => name !== 'pruneRateLimits')).toEqual(viaInngest.calls)
      expect(viaRoute.status).toBe(200)
      expect(viaRoute.body.skipped).toBe(viaInngest.result.skipped)
      expect(viaInngest.result.skipped).toBe(c.quiet ? 'quiet_mode' : undefined)
      if (!c.quiet) {
        for (const key of ['scheduled', 'redispatched', 'reaped', 'approvalsExpired', 'sessionsFailed', 'whatsapp']) {
          expect(viaRoute.body[key], key).toEqual(viaInngest.result[key])
        }
        expect(viaRoute.calls.at(-1)).toEqual(['pruneRateLimits'])
      }
    })
  }

  it('the comparison is not empty: these are the calls of one full run', async () => {
    shared.scheduledOn = true
    vi.setSystemTime(new Date('2026-11-10T10:15:00Z'))

    const { calls } = await runInngest()

    expect(calls).toEqual([
      ['getSetting', 'agents_scheduled'],
      ['enqueueAgentTask', expect.objectContaining({ agentKey: 'every_minute', trigger: 'schedule', idempotencyKey: 'schedule:every_minute:2026-11-10T10:15', kick: false })],
      ['enqueueAgentTask', expect.objectContaining({ agentKey: 'quarterly', trigger: 'schedule', idempotencyKey: 'schedule:quarterly:2026-11-10T10:15', kick: false })],
      ['redispatchPending'],
      ['drainWhatsAppOutbox', { limit: 50, budgetMs: 10_000 }],
      ['drainPointARecalc', { budgetMs: 15_000 }],
      ['drainQueue', { budgetMs: 20_000 }],
    ])
  })

  it('one run at a time and one tick a minute, like the Inngest function', () => {
    // the route's single flight is the stand-in for the concurrency limit
    expect(inngest.opts.concurrency).toEqual({ limit: 1 })
    const drain = CRON_JOBS.find((job) => job.path === '/api/cron/agents')
    expect(inngest.opts.triggers).toEqual([{ cron: drain?.schedule }])
  })

  it('outside the agents role the route is not this loop: no quiet mode and the long budgets, as before', async () => {
    vi.stubEnv('PORTAL_ROLE', '')
    vi.setSystemTime(new Date('2026-11-10T10:07:20Z'))

    const viaRoute = await runRoute()

    expect(viaRoute.body.skipped).toBeUndefined()
    expect(viaRoute.calls).toEqual([
      ['getSetting', 'agents_scheduled'],
      ['redispatchPending'],
      ['drainWhatsAppOutbox', { limit: 50, budgetMs: 30_000 }],
      ['drainPointARecalc', { budgetMs: 60_000 }],
      ['drainQueue', { budgetMs: 180_000 }],
      ['pruneRateLimits'],
    ])
  })
})
