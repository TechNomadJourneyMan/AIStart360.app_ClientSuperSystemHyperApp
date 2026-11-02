/**
 * lib/cron/runner.ts — the in-process scheduler that replaces Vercel Cron on a persistent server.
 * Anti-goal: a job must never fire twice (duplicate client digests and emails), so nothing runs in
 * the minute the process started, and each minute fires at most once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueJobs } from '@/lib/cron/schedule'
import { startCronRunner } from '@/lib/cron/runner'

const SECRET = 's3cr3t'
const BASE = 'https://portal.test'
const paths = (jobs: { path: string }[]) => jobs.map((job) => job.path).sort()

describe('dueJobs', () => {
  it('Monday 04:00 UTC: the CRM, agents and client digests', () => {
    expect(paths(dueJobs(new Date('2026-11-02T04:00:00Z')))).toEqual([
      '/api/cron/agents-digest',
      '/api/cron/client-digest',
      '/api/cron/crm-digest',
    ])
  })

  it('Tuesday 04:00 UTC: the same without the weekly client digest', () => {
    expect(paths(dueJobs(new Date('2026-11-03T04:00:00Z')))).toEqual(['/api/cron/agents-digest', '/api/cron/crm-digest'])
  })

  it('04:01 UTC: nothing', () => {
    expect(dueJobs(new Date('2026-11-02T04:01:00Z'))).toEqual([])
  })

  it('00:15 UTC: billing expiry', () => {
    expect(paths(dueJobs(new Date('2026-11-02T00:15:00Z')))).toEqual(['/api/cron/billing-expiry'])
  })

  it('matches the minute a moment falls in, not only its first millisecond', () => {
    expect(dueJobs(new Date('2026-11-03T04:00:42.500Z')).length).toBe(2)
    expect(dueJobs(new Date('2026-11-03T04:01:00.000Z'))).toEqual([])
  })

  it('reads the schedule in UTC, whatever the clock of the host says', () => {
    // 09:00 in Asia/Almaty (UTC+5) is 04:00 UTC; a host-local reading would miss it
    expect(dueJobs(new Date('2026-11-03T09:00:00+05:00')).length).toBe(2)
    expect(dueJobs(new Date('2026-11-03T04:00:00+05:00'))).toEqual([])
  })

  it('takes the job list as an argument', () => {
    const jobs = [{ path: '/a', schedule: '*/5 * * * *' }, { path: '/b', schedule: '0 * * * *' }]
    expect(paths(dueJobs(new Date('2026-11-02T10:05:00Z'), jobs))).toEqual(['/a'])
    expect(paths(dueJobs(new Date('2026-11-02T10:00:00Z'), jobs))).toEqual(['/a', '/b'])
  })
})

describe('startCronRunner (fake timers)', () => {
  let fetchImpl: ReturnType<typeof vi.fn>
  let lines: string[]
  const log = (line: string) => { lines.push(line) }
  const calledUrls = () => fetchImpl.mock.calls.map((call) => String(call[0])).sort()

  beforeEach(() => {
    vi.useFakeTimers()
    lines = []
    fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function start(startedAt: string, extra: Partial<Parameters<typeof startCronRunner>[0]> = {}) {
    vi.setSystemTime(new Date(startedAt))
    return startCronRunner({ baseUrl: BASE, secret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch, log, ...extra })
  }

  it('started at 03:59:30, it calls the three Monday jobs at 04:00:00 with the bearer secret', async () => {
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)

    expect(calledUrls()).toEqual([
      `${BASE}/api/cron/agents-digest`,
      `${BASE}/api/cron/client-digest`,
      `${BASE}/api/cron/crm-digest`,
    ])
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.method).toBe('GET')
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SECRET}`)
    }
    runner.stop()
  })

  it('does not fire a moment early: the tick is on the minute boundary', async () => {
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetchImpl).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    runner.stop()
  })

  it('started inside the 04:00 minute, it runs nothing in that minute, then carries on', async () => {
    const runner = start('2026-11-02T04:00:10Z')
    await vi.advanceTimersByTimeAsync(50_000) // 04:01:00
    expect(fetchImpl).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(59 * 60_000) // 05:00:00, the Telegram sync
    expect(calledUrls()).toEqual([`${BASE}/api/telegram/personal/sync`])
    runner.stop()
  })

  it('never runs the minute of startedAt even when a tick lands in it', async () => {
    // the clock says 03:59:30 but the process counts as started at 04:00:10: the 04:00 tick is skipped
    const runner = start('2026-11-02T03:59:30Z', { startedAt: new Date('2026-11-02T04:00:10Z') })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchImpl).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 60_000) // 05:00:00
    expect(calledUrls()).toEqual([`${BASE}/api/telegram/personal/sync`])
    runner.stop()
  })

  it('re-arms exactly one timer after every tick, and dueJobs leaves none behind', async () => {
    const runner = start('2026-11-02T03:59:30Z')
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(vi.getTimerCount()).toBe(1)
    runner.stop()
  })

  it('stop() ends the ticks and clears the pending timer', async () => {
    const runner = start('2026-11-02T03:59:30Z')
    runner.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stop() after a tick keeps later jobs from firing', async () => {
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    runner.stop()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000) // past 05:00 and 06:00
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('logs the path, status and duration of every call, and never the secret', async () => {
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)

    const text = lines.join('\n')
    expect(text).toContain('/api/cron/crm-digest')
    expect(text).toContain('/api/cron/agents-digest')
    expect(text).toContain('/api/cron/client-digest')
    expect(lines.filter((line) => /->\s*200\b.*\d+\s*ms/.test(line))).toHaveLength(3)
    expect(text).not.toContain(SECRET)
    runner.stop()
  })

  it('logs a non-2xx answer and keeps running', async () => {
    fetchImpl.mockImplementationOnce(async () => new Response('nope', { status: 500 }))
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(lines.some((line) => line.includes('500') && /fail/i.test(line))).toBe(true)

    await vi.advanceTimersByTimeAsync(60 * 60_000) // 05:00:00
    expect(calledUrls()).toContain(`${BASE}/api/telegram/personal/sync`)
    runner.stop()
  })

  it('logs a failed fetch, keeps the secret out of the message, and keeps running', async () => {
    fetchImpl.mockImplementationOnce(async () => { throw new Error(`connect refused (Authorization: Bearer ${SECRET})`) })
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(3) // the others still ran
    const failure = lines.find((line) => line.includes('connect refused'))
    expect(failure).toBeDefined()
    expect(lines.join('\n')).not.toContain(SECRET)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(calledUrls()).toContain(`${BASE}/api/telegram/personal/sync`)
    runner.stop()
  })

  it('runs at most two requests at once', async () => {
    let active = 0
    let peak = 0
    const gates: (() => void)[] = []
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => {
      active += 1
      peak = Math.max(peak, active)
      gates.push(() => { active -= 1; resolve(new Response('{}', { status: 200 })) })
    }))

    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // the third waits for a free slot

    gates.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    gates.splice(0).forEach((open) => open())
    await vi.advanceTimersByTimeAsync(0)
    expect(peak).toBe(2)
    runner.stop()
  })

  it('shares the two slots across ticks: a slow minute holds the next one back', async () => {
    let active = 0
    let peak = 0
    const gates: (() => void)[] = []
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => {
      active += 1
      peak = Math.max(peak, active)
      gates.push(() => { active -= 1; resolve(new Response('{}', { status: 200 })) })
    }))

    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000) // 04:00: two running, one queued
    await vi.advanceTimersByTimeAsync(60 * 60_000) // 05:00 (Telegram sync) while 04:00 is still stuck
    expect(peak).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    for (let i = 0; i < 10; i += 1) {
      gates.splice(0).forEach((open) => open())
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(peak).toBe(2)
    runner.stop()
  })

  it('does not start queued requests after stop()', async () => {
    const gates: (() => void)[] = []
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => {
      gates.push(() => resolve(new Response('{}', { status: 200 })))
    }))
    const runner = start('2026-11-02T03:59:30Z')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    runner.stop()
    gates.splice(0).forEach((open) => open())
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('startCronRunner (injected clock and timer)', () => {
  // The timer is a fake that only records what was asked, so a test can fire a tick at any moment,
  // early, late or twice: the cases a real setTimeout rarely produces but must not turn into a double run.
  let clock: Date
  let timers: { fn: () => void; delay: number }[]
  let fetchImpl: ReturnType<typeof vi.fn>
  let lines: string[]
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

  beforeEach(() => {
    clock = new Date('2026-11-02T03:59:30.250Z')
    timers = []
    lines = []
    fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
  })

  function start(extra: Partial<Parameters<typeof startCronRunner>[0]> = {}) {
    return startCronRunner({
      baseUrl: BASE,
      secret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
      setTimer: ((fn: () => void, delay: number) => {
        timers.push({ fn, delay })
        return timers.length
      }) as unknown as typeof setTimeout,
      log: (line) => { lines.push(line) },
      ...extra,
    })
  }

  it('arms the timer for the next minute boundary, measured from the clock at that moment', async () => {
    const runner = start()
    expect(timers.map((t) => t.delay)).toEqual([29_750])

    clock = new Date('2026-11-02T04:00:00.020Z') // the tick came 20 ms late
    timers[0].fn()
    await settle()
    expect(timers.map((t) => t.delay)).toEqual([29_750, 59_980]) // aims at 04:01:00, no drift
    runner.stop()
  })

  it('a minute fires at most once, however often its tick is delivered', async () => {
    const runner = start()
    clock = new Date('2026-11-02T04:00:00.010Z')
    timers[0].fn()
    clock = new Date('2026-11-02T04:00:00.400Z')
    timers[1].fn()
    clock = new Date('2026-11-02T04:00:59.900Z')
    timers[2].fn()
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    runner.stop()
  })

  it('a timer that fires early, still inside the previous minute, runs nothing and aims again', async () => {
    const runner = start()
    clock = new Date('2026-11-02T03:59:59.999Z')
    timers[0].fn()
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(timers[1].delay).toBe(1)

    clock = new Date('2026-11-02T04:00:00.000Z')
    timers[1].fn()
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    runner.stop()
  })

  it('a started-at minute is skipped even if its tick is delivered', async () => {
    const runner = start({ startedAt: new Date('2026-11-02T04:00:10Z') })
    clock = new Date('2026-11-02T04:00:59.999Z')
    timers[0].fn()
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
    runner.stop()
  })

  it('startedAt defaults to the clock at start', async () => {
    clock = new Date('2026-11-02T04:00:10Z')
    const runner = start()
    clock = new Date('2026-11-02T04:00:59.999Z')
    timers[0].fn()
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
    runner.stop()
  })

  it('a tick after stop() does nothing and arms nothing', async () => {
    const runner = start()
    runner.stop()
    clock = new Date('2026-11-02T04:00:00.000Z')
    timers[0].fn()
    await settle()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(timers).toHaveLength(1)
  })

  it('logs a tick that fails and still arms the next minute', async () => {
    let failNext = false
    const runner = start({ now: () => { if (failNext) { failNext = false; throw new Error('clock failure') } return clock } })
    failNext = true
    timers[0].fn()
    await settle()
    expect(lines.some((line) => line.includes('clock failure'))).toBe(true)
    expect(timers).toHaveLength(2)
    runner.stop()
  })
})
