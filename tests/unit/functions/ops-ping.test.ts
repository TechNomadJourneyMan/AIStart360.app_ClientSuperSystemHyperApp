/**
 * lib/functions/ops-ping.ts — the heartbeat of our Inngest and the journal of scheduled runs (R4-A1).
 *
 * withRunJournal attaches a middleware to a function that already exists (the function files stay as
 * they are). That only works because the SDK reads `fn.opts.middleware` on every request, so this is
 * pinned with the REAL serve handler of inngest/next and a dev-mode client (no signing): a run that
 * completes is one 'ok' row, a run whose last attempt fails is one 'error' row with the message, an
 * attempt that will be retried writes nothing. The journal itself is a recorder stub here.
 */
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Inngest } from 'inngest'
import { serve } from 'inngest/next'
import type { JobOutcome } from '@/lib/ops/job-journal'

vi.mock('@/lib/inngest', async () => {
  const { Inngest: Client } = await import('inngest')
  return { inngest: new Client({ id: 'aistart360', isDev: true }) }
})

import { RunJournal, cronTriggersOf, functionIdOf, opsPing, setRunJournalRecorder, withRunJournal, OPS_PING_CRON } from '@/lib/functions/ops-ping'

const records: JobOutcome[] = []
let recordResult = true

beforeAll(() => {
  setRunJournalRecorder(async (outcome) => {
    records.push(outcome)
    return recordResult
  })
})
afterAll(() => setRunJournalRecorder(null))
beforeEach(() => {
  records.length = 0
  recordResult = true
  vi.stubEnv('INNGEST_SIGNING_KEY', '')
  vi.stubEnv('INNGEST_DEV', '1')
})
afterEach(() => vi.unstubAllEnvs())

const client = new Inngest({ id: 'ops-test', isDev: true })
const work = vi.fn(async () => ({ done: true }))
const tick = client.createFunction({ id: 'tick', retries: 0, triggers: [{ cron: 'TZ=Asia/Almaty 30 4 * * *' }] }, async () => work())
const boom = client.createFunction({ id: 'boom', retries: 2, triggers: [{ cron: '0 * * * *' }] }, async () => {
  throw new Error('the work failed\nsecond line')
})
const plain = client.createFunction({ id: 'plain', retries: 0, triggers: [{ cron: '*/5 * * * *' }] }, async () => ({ ok: true }))

const TICK_TS = Date.parse('2026-11-16T23:30:00Z')

function runRequest(fnSlug: string, attempt = 0, maxAttempts = 1) {
  const event = { name: 'inngest/scheduled.timer', data: { cron: '0 * * * *' }, id: 'evt-1', ts: TICK_TS }
  return new NextRequest(`http://localhost:3000/api/inngest?fnId=ops-test-${fnSlug}&stepId=step`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event,
      events: [event],
      steps: {},
      ctx: { run_id: `run-${fnSlug}-${attempt}`, attempt, max_attempts: maxAttempts, disable_immediate_execution: true, use_api: false, stack: { stack: [], current: 0 } },
      version: 1,
    }),
  })
}

const handler = serve({ client, functions: [withRunJournal(tick), withRunJournal(boom), plain] })
const post = (req: NextRequest) => (handler.POST as unknown as (r: NextRequest, ctx: unknown) => Promise<Response>)(req, {})

describe('withRunJournal through the real serve handler', () => {
  it('a run that completes is one ok row: the journal job id, the kind, the start = the cron tick', async () => {
    const res = await post(runRequest('tick'))
    expect(res.status).toBe(200)
    expect(work).toHaveBeenCalledTimes(1)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ job: 'inngest:tick', kind: 'inngest', status: 'ok' })
    expect(records[0].startedAt.getTime()).toBe(TICK_TS)
  })

  it('the last attempt that fails is one error row with the first line of the message', async () => {
    await post(runRequest('boom', 2, 3))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ job: 'inngest:boom', kind: 'inngest', status: 'error', error: 'the work failed' })
  })

  it('an attempt that will be retried is not an outcome yet: nothing is written', async () => {
    await post(runRequest('boom', 0, 3))
    expect(records).toEqual([])
  })

  it('a function without the wrapper writes nothing', async () => {
    const res = await post(runRequest('plain'))
    expect(res.status).toBe(200)
    expect(records).toEqual([])
  })

  it('the wrapper is attached once and keeps the function object (the registry compares by identity)', () => {
    const before = (tick as unknown as { opts: { middleware: unknown[] } }).opts.middleware.length
    expect(withRunJournal(tick)).toBe(tick)
    expect((tick as unknown as { opts: { middleware: unknown[] } }).opts.middleware).toHaveLength(before)
    expect((tick as unknown as { opts: { middleware: unknown[] } }).opts.middleware).toContain(RunJournal)
  })

  it('the wrapper changes nothing Inngest registers (PUT /api/inngest): the same config with and without it', () => {
    const fresh = client.createFunction({ id: 'fresh', retries: 1, concurrency: { limit: 1 }, triggers: [{ cron: '*/5 * * * *' }] }, async () => ({ ok: true }))
    const cfg = () => (fresh as unknown as { getConfig: (o: { baseUrl: URL; appPrefix: string }) => unknown }).getConfig({ baseUrl: new URL('http://localhost:3000/api/inngest'), appPrefix: 'ops-test' })
    const before = JSON.stringify(cfg())
    withRunJournal(fresh)
    expect(JSON.stringify(cfg())).toBe(before)
    expect(functionIdOf(fresh)).toBe('fresh')
  })

  it('reads the id and the cron triggers of a function', () => {
    expect(functionIdOf(tick)).toBe('tick')
    expect(cronTriggersOf(tick)).toEqual(['TZ=Asia/Almaty 30 4 * * *'])
  })
})

describe('ops-ping', () => {
  it('runs every 10 minutes with the project limits (one at a time, start/finish timeouts)', () => {
    const opts = (opsPing as unknown as { opts: { id: string; concurrency: { limit: number }; timeouts: { start: string; finish: string }; retries: number } }).opts
    expect(opts.id).toBe('ops-ping')
    expect(cronTriggersOf(opsPing)).toEqual([OPS_PING_CRON])
    expect(OPS_PING_CRON).toBe('*/10 * * * *')
    expect(opts.concurrency.limit).toBe(1)
    expect(opts.retries).toBe(0)
    expect(opts.timeouts.start).toBeTruthy()
    expect(opts.timeouts.finish).toBeTruthy()
  })

  it('writes its own heartbeat row, and fails the run when the row did not go in', async () => {
    const fn = (opsPing as unknown as { fn: (arg: unknown) => Promise<unknown> }).fn
    await expect(fn({ event: { ts: TICK_TS } })).resolves.toEqual({ ok: true })
    expect(records).toEqual([expect.objectContaining({ job: 'inngest:ops-ping', kind: 'inngest', status: 'ok', startedAt: new Date(TICK_TS) })])

    recordResult = false
    await expect(fn({ event: { ts: TICK_TS } })).rejects.toThrow(/journal row was not written/)
  })
})
