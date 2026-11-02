/**
 * lib/cron/runner.ts — the in-process scheduler that replaces Vercel Cron on a persistent server.
 * Anti-goal: a job must never fire twice (duplicate client digests and emails), so nothing runs in
 * the minute the process started, and each minute fires at most once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueJobs } from '@/lib/cron/schedule'
import { startCronRunner } from '@/lib/cron/runner'
import { pendingBackgroundCount } from '@/lib/background'

const SECRET = 's3cr3t'
const BASE = 'https://portal.test'
const paths = (jobs: { path: string }[]) => jobs.map((job) => job.path).sort()

// The one-runner-per-process guard lives on globalThis (see lib/cron/runner.ts). A test that fails
// before its stop() must not leave it set for the next one.
const RUNNER_GUARD = Symbol.for('aistart360.cron.runner')
// Same for the set of unfinished background work: a call gated forever must not count in the next test.
const PENDING_WORK = Symbol.for('aistart360.background.pending')
const clearGuard = () => {
  delete (globalThis as Record<symbol, unknown>)[RUNNER_GUARD]
  delete (globalThis as Record<symbol, unknown>)[PENDING_WORK]
}
afterEach(clearGuard)

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

describe('startCronRunner (claim across instances)', () => {
  // Two instances overlap during a redeploy: both tick at 04:00:00. The claim is the only thing
  // standing between that and two digests per client.
  let fetchImpl: ReturnType<typeof vi.fn>
  let lines: string[]
  const log = (line: string) => { lines.push(line) }

  beforeEach(() => {
    vi.useFakeTimers()
    lines = []
    fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function start(claim: (path: string, minute: Date) => Promise<boolean>, extra: Partial<Parameters<typeof startCronRunner>[0]> = {}) {
    vi.setSystemTime(new Date('2026-11-02T03:59:30Z'))
    return startCronRunner({ baseUrl: BASE, secret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch, log, claim, ...extra })
  }

  /** What the Postgres table does: the first caller for a (path, minute) wins, everyone after loses. */
  const sharedClaim = () => {
    const taken = new Set<string>()
    return async (path: string, minute: Date) => {
      const key = `${path}@${minute.toISOString()}`
      if (taken.has(key)) return false
      taken.add(key)
      return true
    }
  }

  it('two runners sharing one claim fire each (path, minute) exactly once', async () => {
    const claim = sharedClaim()
    const first = start(claim)
    clearGuard() // the second runner stands for another process, which has its own guard
    const second = start(claim)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const urls = fetchImpl.mock.calls.map((call) => String(call[0])).sort()
    expect(new Set(urls).size).toBe(3)
    expect(lines.filter((line) => line.includes('уже запущено другим экземпляром'))).toHaveLength(3)

    // a full day on: 3 at 04:00 Monday + Telegram sync, reminders, rollup, billing expiry,
    // AI discovery, staff digest and the two Tuesday digests - each once, though both runners ticked
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(fetchImpl).toHaveBeenCalledTimes(11)
    first.stop()
    second.stop()
  })

  it('asks the claim for the path and the UTC minute it is about to run', async () => {
    const claim = vi.fn(async () => true)
    const runner = start(claim)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(claim).toHaveBeenCalledTimes(3)
    expect(claim).toHaveBeenCalledWith('/api/cron/crm-digest', new Date('2026-11-02T04:00:00Z'))
    expect(claim).toHaveBeenCalledWith('/api/cron/agents-digest', new Date('2026-11-02T04:00:00Z'))
    expect(claim).toHaveBeenCalledWith('/api/cron/client-digest', new Date('2026-11-02T04:00:00Z'))
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    runner.stop()
  })

  it('a lost claim means no fetch, and the log says another instance has it', async () => {
    const runner = start(async () => false)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).not.toHaveBeenCalled()
    const skipped = lines.filter((line) => line.includes('уже запущено другим экземпляром'))
    expect(skipped).toHaveLength(3)
    expect(skipped.some((line) => line.includes('/api/cron/crm-digest'))).toBe(true)
    runner.stop()
  })

  it('a claim that throws means no fetch (never fire without a claim) and an error line, secret masked', async () => {
    const runner = start(async () => { throw new Error(`connection to db refused (token ${SECRET})`) })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).not.toHaveBeenCalled()
    const failure = lines.filter((line) => line.includes('connection to db refused'))
    expect(failure).toHaveLength(3)
    expect(failure.every((line) => /claim/i.test(line))).toBe(true)
    expect(lines.join('\n')).not.toContain(SECRET)

    // the runner survives it: the next due minute asks again
    await vi.advanceTimersByTimeAsync(60 * 60_000) // 05:00:00
    expect(lines.filter((line) => line.includes('/api/telegram/personal/sync')).length).toBeGreaterThan(0)
    runner.stop()
  })

  it('a rejected claim for one job does not hold back the others', async () => {
    const claim = vi.fn(async (path: string) => {
      if (path === '/api/cron/crm-digest') throw new Error('boom')
      return true
    })
    const runner = start(claim)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain(`${BASE}/api/cron/crm-digest`)
    runner.stop()
  })

  it('does not claim a job once the runner is stopped', async () => {
    const gates: (() => void)[] = []
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => {
      gates.push(() => resolve(new Response('{}', { status: 200 })))
    }))
    const claim = vi.fn(async () => true)
    const runner = start(claim)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(claim).toHaveBeenCalledTimes(2) // two slots; the third job waits

    runner.stop()
    gates.splice(0).forEach((open) => open())
    await vi.advanceTimersByTimeAsync(0)
    expect(claim).toHaveBeenCalledTimes(2) // a claim taken and then not fired would lose that run
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('startCronRunner (fetch timeout)', () => {
  let fetchImpl: ReturnType<typeof vi.fn>
  let lines: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    lines = []
    fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function start() {
    vi.setSystemTime(new Date('2026-11-02T03:59:30Z'))
    return startCronRunner({ baseUrl: BASE, secret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch, log: (line) => { lines.push(line) } })
  }

  it('every call carries an abort signal that fires after 300 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const runner = start()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(timeout).toHaveBeenCalledWith(300_000)
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
    runner.stop()
  })

  it('a call that times out is logged like any other failure and does not stop the runner', async () => {
    fetchImpl.mockImplementationOnce(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const runner = start()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(lines.some((line) => /error/.test(line) && /timeout/i.test(line))).toBe(true)

    await vi.advanceTimersByTimeAsync(60 * 60_000) // 05:00:00
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain(`${BASE}/api/telegram/personal/sync`)
    runner.stop()
  })
})

describe('startCronRunner (one per process)', () => {
  let fetchImpl: ReturnType<typeof vi.fn>
  let lines: string[]
  const log = (line: string) => { lines.push(line) }

  beforeEach(() => {
    vi.useFakeTimers()
    lines = []
    fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function start(extra: Partial<Parameters<typeof startCronRunner>[0]> = {}) {
    vi.setSystemTime(new Date('2026-11-02T03:59:30Z'))
    return startCronRunner({ baseUrl: BASE, secret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch, log, ...extra })
  }

  it('a second start returns the first handle, warns, and starts no second ticker', async () => {
    const first = start()
    const second = start()

    expect(second).toBe(first)
    expect(vi.getTimerCount()).toBe(1)
    expect(lines.filter((line) => /already running|уже запущен/i.test(line))).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // once, not twice
    first.stop()
  })

  it('the warning goes to the log of the call that was refused', () => {
    const first = start()
    const refusedLines: string[] = []
    start({ log: (line) => { refusedLines.push(line) } })

    expect(refusedLines.length).toBe(1)
    expect(refusedLines[0]).toMatch(/cron/)
    first.stop()
  })

  it('stop() clears the guard, so a new runner can start afterwards', () => {
    const first = start()
    first.stop()
    expect(vi.getTimerCount()).toBe(0)

    const second = start()
    expect(second).not.toBe(first)
    expect(vi.getTimerCount()).toBe(1)
    second.stop()
  })

  it('a stale handle stopped again does not clear the guard of the runner that replaced it', () => {
    const first = start()
    first.stop()
    const second = start()
    first.stop() // called twice, late

    const third = start()
    expect(third).toBe(second)
    expect(vi.getTimerCount()).toBe(1)
    second.stop()
  })

  it('the guard is on globalThis, so another copy of the module sees it', () => {
    const first = start()
    expect((globalThis as Record<symbol, unknown>)[RUNNER_GUARD]).toBe(first)
    first.stop()
    expect((globalThis as Record<symbol, unknown>)[RUNNER_GUARD]).toBeUndefined()
  })
})

describe('startCronRunner (in-flight calls are tracked as background work)', () => {
  // A deploy during a digest sends SIGTERM to the old instance: the shutdown waits for tracked work,
  // and the (path, minute) claim of a call cut short is already spent, so that run would be lost.
  let fetchImpl: ReturnType<typeof vi.fn>
  let gates: (() => void)[]

  beforeEach(() => {
    vi.useFakeTimers()
    gates = []
    fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      gates.push(() => resolve(new Response('{}', { status: 200 })))
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function start(extra: Partial<Parameters<typeof startCronRunner>[0]> = {}) {
    vi.setSystemTime(new Date('2026-11-02T03:59:30Z'))
    return startCronRunner({ baseUrl: BASE, secret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch, log: () => {}, ...extra })
  }

  it('a started cron call keeps the pending count above zero until its fetch settles', async () => {
    const runner = start()
    expect(pendingBackgroundCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(30_000) // 04:00:00 - three jobs, two slots
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(pendingBackgroundCount()).toBe(3) // two in flight and the one waiting for a slot

    gates.splice(0).forEach((open) => open())
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(pendingBackgroundCount()).toBe(1) // the third one is the only one left

    gates.splice(0).forEach((open) => open())
    await vi.advanceTimersByTimeAsync(0)
    expect(pendingBackgroundCount()).toBe(0)
    runner.stop()
  })

  it('a call that fails still leaves the set (and the runner is not told)', async () => {
    fetchImpl.mockImplementation(async () => { throw new Error('connect refused') })
    const runner = start()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(pendingBackgroundCount()).toBe(0)
    runner.stop()
  })

  it('a job that loses the claim is not left pending', async () => {
    const runner = start({ claim: async () => false })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(pendingBackgroundCount()).toBe(0)
    runner.stop()
  })

  it('after stop() the queued jobs end without a fetch, so the shutdown wait is only for calls already made', async () => {
    const runner = start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(pendingBackgroundCount()).toBe(3)

    runner.stop()
    gates.splice(0).forEach((open) => open())
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchImpl).toHaveBeenCalledTimes(2) // the queued third call never started
    expect(pendingBackgroundCount()).toBe(0)
  })

  it('stays clear of the count when nothing is due', async () => {
    const runner = start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pendingBackgroundCount()).toBe(0)
    runner.stop()
  })
})
