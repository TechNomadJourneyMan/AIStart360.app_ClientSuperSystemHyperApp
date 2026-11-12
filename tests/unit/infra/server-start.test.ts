/**
 * lib/runtime/server-start.ts — what a persistent server (Railway) starts when it boots: the
 * Workflow queue, the in-process cron, and the SIGTERM handler that lets after-response work
 * finish before the process exits. Every dependency is a stub; nothing here touches a database.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  world: { start: vi.fn(async () => {}) } as { start?: () => Promise<void> },
  // what WORKFLOW_POSTGRES_WORKER_CONCURRENCY said at each getWorld() call (createWorld reads it right then)
  concurrencySeen: [] as (string | undefined)[],
}))
vi.mock('workflow/runtime', () => ({
  getWorld: () => {
    runtime.concurrencySeen.push(process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY)
    return runtime.world
  },
}))

import { queueRetryDelayMs, startPersistentServer } from '@/lib/runtime/server-start'
import { getWorkflowQueueStatus } from '@/lib/runtime/workflow-queue-status'
import { trackBackground, waitForBackgroundWork } from '@/lib/background'

type Handler = () => void

const FULL_ENV: Partial<NodeJS.ProcessEnv> = {
  PERSISTENT_SERVER: '1',
  NEXT_MANUAL_SIG_HANDLE: 'true',
  WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
  CRON_RUNNER_ENABLED: '1',
  CRON_SECRET: 'x',
  PORT: '8080',
}
// The same without the Workflow queue: nothing for graphile-worker to stop, so nothing to wait for.
const NO_QUEUE_ENV: Partial<NodeJS.ProcessEnv> = {
  PERSISTENT_SERVER: '1',
  NEXT_MANUAL_SIG_HANDLE: 'true',
  CRON_RUNNER_ENABLED: '1',
  CRON_SECRET: 'x',
  PORT: '8080',
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

/** A directory per test: with or without a vercel.json (the cron guard reads it from the cwd). */
function dirWith(vercelJson?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-start-'))
  if (vercelJson !== undefined) fs.writeFileSync(path.join(dir, 'vercel.json'), vercelJson)
  return dir
}
const VERCEL_WITH_CRONS = JSON.stringify({
  regions: ['dub1'],
  crons: [{ path: '/api/cron/billing-expiry', schedule: '15 0 * * *' }],
})

function setup(opts: { cwd?: string } = {}) {
  const lines: string[] = []
  const errors: string[] = []
  const stopCron = vi.fn()
  const handlers = new Map<string, Handler>()
  const startWorld = vi.fn(async () => {})
  const startCron = vi.fn((_opts: unknown) => ({ stop: stopCron }))
  const onSignal = vi.fn((sig: 'SIGTERM' | 'SIGINT', handler: Handler) => { handlers.set(sig, handler) })
  const exit = vi.fn((_code: number) => {})
  const cwd = opts.cwd ?? dirWith() // no vercel.json: the cron guard lets the runner start
  const deps = {
    startWorld,
    startCron: startCron as unknown as NonNullable<Parameters<typeof startPersistentServer>[1]>['startCron'],
    onSignal,
    exit,
    cwd: () => cwd,
    log: (line: string) => { lines.push(line) },
    logError: (line: string) => { lines.push(line); errors.push(line) },
  }
  return { deps, lines, errors, stopCron, handlers, startWorld, startCron, onSignal, exit, text: () => lines.join('\n') }
}

/** Boots with the queue and waits until its (background) start has gone through. */
async function bootRunning(t: ReturnType<typeof setup>, env: Partial<NodeJS.ProcessEnv> = FULL_ENV) {
  const result = await startPersistentServer(env, t.deps)
  await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))
  return result
}

/** The same under fake timers: the stub resolves at once, so flushing the microtasks is enough. */
async function bootRunningFake(t: ReturnType<typeof setup>, env: Partial<NodeJS.ProcessEnv> = FULL_ENV) {
  const result = await startPersistentServer(env, t.deps)
  await vi.advanceTimersByTimeAsync(0)
  expect(getWorkflowQueueStatus().state).toBe('running')
  return result
}

const QUEUE_STATUS_KEY = Symbol.for('aistart360.workflow.queue.status')

afterEach(async () => {
  // a test must not leave tracked work behind for the next one
  await waitForBackgroundWork(1000)
  delete (globalThis as Record<symbol, unknown>)[QUEUE_STATUS_KEY]
})

describe('startPersistentServer: what it starts', () => {
  it('an empty environment starts nothing and registers no signal handler', async () => {
    const t = setup()

    await expect(startPersistentServer({}, t.deps)).resolves.toEqual({ world: false, cron: false })

    expect(t.startWorld).not.toHaveBeenCalled()
    expect(t.startCron).not.toHaveBeenCalled()
    expect(t.onSignal).not.toHaveBeenCalled()
  })

  it('the full environment starts the queue and the cron against 127.0.0.1 and the PORT', async () => {
    const t = setup()

    await expect(startPersistentServer(FULL_ENV, t.deps)).resolves.toEqual({ world: true, cron: true })

    expect(t.startWorld).toHaveBeenCalledTimes(1)
    expect(t.startCron).toHaveBeenCalledTimes(1)
    expect(t.startCron.mock.calls[0][0]).toMatchObject({ baseUrl: 'http://127.0.0.1:8080', secret: 'x' })
  })

  it('PORT defaults to 3000', async () => {
    const t = setup()
    const { PORT: _port, ...env } = FULL_ENV

    await startPersistentServer(env, t.deps)

    expect(t.startCron.mock.calls[0][0]).toMatchObject({ baseUrl: 'http://127.0.0.1:3000' })
  })

  it('the queue starts only for the Postgres world', async () => {
    for (const world of [undefined, '', 'local', '@workflow/world-vercel', '@workflow/world-postgres ']) {
      const t = setup()
      const env = { PERSISTENT_SERVER: '1', ...(world === undefined ? {} : { WORKFLOW_TARGET_WORLD: world }) }
      const result = await startPersistentServer(env, t.deps)
      expect(result.world, `world=${String(world)}`).toBe(false)
      expect(t.startWorld).not.toHaveBeenCalled()
    }
  })

  it('the queue alone: no cron without CRON_RUNNER_ENABLED=1', async () => {
    const t = setup()
    const env = { PERSISTENT_SERVER: '1', WORKFLOW_TARGET_WORLD: '@workflow/world-postgres', CRON_SECRET: 'x' }

    await expect(startPersistentServer(env, t.deps)).resolves.toEqual({ world: true, cron: false })
    expect(t.startCron).not.toHaveBeenCalled()
  })

  it('CRON_RUNNER_ENABLED=1 without CRON_SECRET: no cron, and the log says why', async () => {
    const t = setup()
    const env = { PERSISTENT_SERVER: '1', CRON_RUNNER_ENABLED: '1' }

    await expect(startPersistentServer(env, t.deps)).resolves.toEqual({ world: false, cron: false })

    expect(t.startCron).not.toHaveBeenCalled()
    expect(t.text()).toContain('CRON_SECRET')
  })

  it('an empty CRON_SECRET counts as missing', async () => {
    const t = setup()
    const env = { PERSISTENT_SERVER: '1', CRON_RUNNER_ENABLED: '1', CRON_SECRET: '' }

    await expect(startPersistentServer(env, t.deps)).resolves.toEqual({ world: false, cron: false })
    expect(t.startCron).not.toHaveBeenCalled()
  })


  it('never logs the cron secret', async () => {
    const t = setup()
    await startPersistentServer({ ...FULL_ENV, CRON_SECRET: 'very-secret-value' }, t.deps)
    expect(t.text()).not.toContain('very-secret-value')
  })
})

// A Workflow database that is down must not take the whole portal down: Next awaits register()
// before it serves, so the queue starts in the background and keeps retrying with a backoff.
describe('startPersistentServer: the Workflow queue starts in the background', () => {
  const WF_URL = 'postgres://wfuser:hunter2-secret@workflow-db.invalid:5432/railway'

  it('the boot does not wait for a queue start that hangs', async () => {
    const t = setup()
    t.startWorld.mockImplementation(() => new Promise<void>(() => {})) // never settles

    await expect(startPersistentServer(FULL_ENV, t.deps)).resolves.toEqual({ world: true, cron: true })

    expect(t.startWorld).toHaveBeenCalledTimes(1)
    expect(t.startCron).toHaveBeenCalledTimes(1)
    expect([...t.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])
    expect(getWorkflowQueueStatus()).toMatchObject({ state: 'starting', attempts: 1 })
  })

  it('a queue that cannot start does not fail the boot: one loud, masked line, and the rest starts', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld.mockRejectedValue(new Error(`connect ECONNREFUSED via ${WF_URL} (user wfuser, password hunter2-secret)`))

      await expect(startPersistentServer({ ...FULL_ENV, WORKFLOW_POSTGRES_URL: WF_URL }, t.deps)).resolves.toEqual({ world: true, cron: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(t.startCron).toHaveBeenCalledTimes(1)
      expect(t.errors).toHaveLength(1)
      expect(t.errors[0]).toContain('ECONNREFUSED')
      expect(t.errors[0]).toMatch(/попытка 1/)
      expect(t.errors[0]).toMatch(/5 с/)
      expect(t.text()).not.toContain('hunter2-secret')
      expect(t.text()).not.toContain('wfuser')
      expect(t.text()).not.toContain(WF_URL)
      const status = getWorkflowQueueStatus()
      expect(status).toMatchObject({ state: 'retrying', attempts: 1 })
      expect(status.lastError).toContain('ECONNREFUSED')
      expect(status.lastError).not.toContain('hunter2-secret')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a start() that throws synchronously is retried like a rejection', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld.mockImplementationOnce(() => { throw new Error('boom') })

      await expect(startPersistentServer(FULL_ENV, t.deps)).resolves.toEqual({ world: true, cron: true })
      await vi.advanceTimersByTimeAsync(0)
      expect(getWorkflowQueueStatus()).toMatchObject({ state: 'retrying', attempts: 1 })

      await vi.advanceTimersByTimeAsync(5_000)
      expect(t.startWorld).toHaveBeenCalledTimes(2)
      expect(getWorkflowQueueStatus()).toMatchObject({ state: 'running', attempts: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries with an exponential backoff (5 s, 10 s, 20 s ...) until it starts', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld
        .mockRejectedValueOnce(new Error('down 1'))
        .mockRejectedValueOnce(new Error('down 2'))
        .mockRejectedValueOnce(new Error('down 3'))
      await startPersistentServer(FULL_ENV, t.deps)
      await vi.advanceTimersByTimeAsync(0)
      expect(t.startWorld).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(4_999)
      expect(t.startWorld).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(t.startWorld).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(9_999)
      expect(t.startWorld).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(t.startWorld).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(19_999)
      expect(t.startWorld).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(t.startWorld).toHaveBeenCalledTimes(4) // this one succeeds

      expect(getWorkflowQueueStatus()).toEqual({ state: 'running', attempts: 4 })
      expect(t.errors).toHaveLength(3) // one line per failed attempt
      expect(t.errors.map((line) => /попытка (\d+)/.exec(line)?.[1])).toEqual(['1', '2', '3'])
      expect(t.text()).toMatch(/Workflow queue started/)

      // started: no more attempts
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(t.startWorld).toHaveBeenCalledTimes(4)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the backoff doubles from 5 s and is capped at 5 min, with no limit on attempts', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50, 1000].map(queueRetryDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000, 300_000,
    ])
  })

  it('keeps retrying every 5 min past the cap', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld.mockRejectedValue(new Error('still down'))
      await startPersistentServer(FULL_ENV, t.deps)
      // 5 + 10 + 20 + 40 + 80 + 160 s = 315 s brings the 7th attempt; then one every 300 s
      await vi.advanceTimersByTimeAsync(315_000)
      expect(t.startWorld).toHaveBeenCalledTimes(7)
      await vi.advanceTimersByTimeAsync(299_999)
      expect(t.startWorld).toHaveBeenCalledTimes(7)
      await vi.advanceTimersByTimeAsync(1)
      expect(t.startWorld).toHaveBeenCalledTimes(8)
      await vi.advanceTimersByTimeAsync(300_000 * 10)
      expect(t.startWorld).toHaveBeenCalledTimes(18)
      expect(getWorkflowQueueStatus()).toMatchObject({ state: 'retrying', attempts: 18 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('status: off before the boot, starting during the first attempt, retrying after a failure, running once started', async () => {
    vi.useFakeTimers()
    try {
      expect(getWorkflowQueueStatus()).toEqual({ state: 'off', attempts: 0 })
      const t = setup()
      let failFirst!: (e: Error) => void
      let succeedSecond!: () => void
      t.startWorld
        .mockImplementationOnce(() => new Promise<void>((_, reject) => { failFirst = reject }))
        .mockImplementationOnce(() => new Promise<void>((resolve) => { succeedSecond = resolve }))

      await startPersistentServer(FULL_ENV, t.deps)
      expect(getWorkflowQueueStatus()).toEqual({ state: 'starting', attempts: 1 })

      failFirst(new Error('ECONNREFUSED'))
      await vi.advanceTimersByTimeAsync(0)
      expect(getWorkflowQueueStatus()).toMatchObject({ state: 'retrying', attempts: 1, lastError: 'ECONNREFUSED' })

      await vi.advanceTimersByTimeAsync(5_000) // the second attempt is in flight
      expect(getWorkflowQueueStatus()).toMatchObject({ state: 'retrying', attempts: 2, lastError: 'ECONNREFUSED' })

      succeedSecond()
      await vi.advanceTimersByTimeAsync(0)
      expect(getWorkflowQueueStatus()).toEqual({ state: 'running', attempts: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('without the Postgres world the status stays off', async () => {
    const t = setup()
    await startPersistentServer(NO_QUEUE_ENV, t.deps)
    expect(getWorkflowQueueStatus()).toEqual({ state: 'off', attempts: 0 })
  })

  it('SIGTERM while retrying: stops the retries and exits without waiting for the queue', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld.mockRejectedValue(new Error('ECONNREFUSED'))
      await startPersistentServer(FULL_ENV, t.deps)
      await vi.advanceTimersByTimeAsync(0)
      expect(getWorkflowQueueStatus().state).toBe('retrying')

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(0)

      // no re-sent signal is coming from a queue that never ran: exit at once
      expect(t.exit).toHaveBeenCalledWith(0)
      expect(t.exit).toHaveBeenCalledTimes(1)
      expect(t.stopCron).toHaveBeenCalledTimes(1)
      expect(t.text()).toMatch(/очередь Workflow не запущена/)

      // and no more attempts after the stop
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(t.startWorld).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('SIGTERM while the first attempt still hangs: exits after the tracked work, without the queue wait', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld.mockImplementation(() => new Promise<void>(() => {}))
      const work = deferred()
      trackBackground(work.promise)
      await startPersistentServer(FULL_ENV, t.deps)

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(t.exit).not.toHaveBeenCalled() // the tracked work still runs

      work.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(t.exit).toHaveBeenCalledWith(0)
      expect(t.text()).not.toMatch(/не подтвердила остановку/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an attempt that fails after SIGTERM schedules no retry', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      let fail!: (e: Error) => void
      t.startWorld.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject }))
      await startPersistentServer(FULL_ENV, t.deps)

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(0)
      expect(t.exit).toHaveBeenCalledWith(0)

      fail(new Error('ECONNREFUSED'))
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(t.startWorld).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('once the queue is running, SIGTERM still waits for its own stop (the re-sent signal)', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      t.startWorld.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      await startPersistentServer(FULL_ENV, t.deps)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(getWorkflowQueueStatus().state).toBe('running')

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(t.exit).not.toHaveBeenCalled()

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(0)
      expect(t.exit).toHaveBeenCalledWith(0)
      expect(t.text()).toMatch(/очередь Workflow остановлена/)
    } finally {
      vi.useRealTimers()
    }
  })
})

// While Vercel's crons are still in the deployed vercel.json, Vercel runs those jobs; a runner here
// would run every one of them a second time.
describe('startPersistentServer: the cron runner is refused while vercel.json still has crons', () => {
  it('crons in vercel.json: the runner is not started, and the log says why', async () => {
    const t = setup({ cwd: dirWith(VERCEL_WITH_CRONS) })

    await expect(startPersistentServer(NO_QUEUE_ENV, t.deps)).resolves.toEqual({ world: false, cron: false })

    expect(t.startCron).not.toHaveBeenCalled()
    expect(t.errors.join('\n')).toMatch(/vercel\.json/)
    expect(t.errors.join('\n')).toMatch(/crons/)
    // the shutdown handler is still there on a persistent server
    expect([...t.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])
  })

  it('the queue still starts when the runner is refused', async () => {
    const t = setup({ cwd: dirWith(VERCEL_WITH_CRONS) })
    await expect(startPersistentServer(FULL_ENV, t.deps)).resolves.toEqual({ world: true, cron: false })
    expect(t.startWorld).toHaveBeenCalledTimes(1)
  })

  it('vercel.json without crons: the runner starts', async () => {
    const t = setup({ cwd: dirWith(JSON.stringify({ regions: ['dub1'] })) })
    await expect(startPersistentServer(NO_QUEUE_ENV, t.deps)).resolves.toEqual({ world: false, cron: true })
    expect(t.startCron).toHaveBeenCalledTimes(1)
  })

  it('an empty crons array: the runner starts', async () => {
    const t = setup({ cwd: dirWith(JSON.stringify({ regions: ['dub1'], crons: [] })) })
    await expect(startPersistentServer(NO_QUEUE_ENV, t.deps)).resolves.toEqual({ world: false, cron: true })
  })

  it('no vercel.json at all: the runner starts', async () => {
    const t = setup({ cwd: dirWith() })
    await expect(startPersistentServer(NO_QUEUE_ENV, t.deps)).resolves.toEqual({ world: false, cron: true })
  })

  it('a vercel.json that cannot be read or parsed: the runner starts', async () => {
    const t = setup({ cwd: dirWith('{ not json') })
    await expect(startPersistentServer(NO_QUEUE_ENV, t.deps)).resolves.toEqual({ world: false, cron: true })
  })

  it('crons in vercel.json do not matter when the runner is not enabled', async () => {
    const t = setup({ cwd: dirWith(VERCEL_WITH_CRONS) })
    await startPersistentServer({ PERSISTENT_SERVER: '1' }, t.deps)
    expect(t.text()).not.toMatch(/vercel\.json/)
  })
})

describe('startPersistentServer: cron claim across instances', () => {
  it('with WORKFLOW_POSTGRES_URL the cron gets a claim function (and no connection is opened to build it)', async () => {
    const t = setup()
    const env = { ...FULL_ENV, WORKFLOW_POSTGRES_URL: 'postgres://user:pw@unreachable.invalid:5432/db' }

    await startPersistentServer(env, t.deps)

    const opts = t.startCron.mock.calls[0][0] as { claim?: unknown }
    expect(typeof opts.claim).toBe('function')
    expect(t.text()).not.toContain('pw@')
  })

  it('without WORKFLOW_POSTGRES_URL the cron starts without a claim and the log warns about duplicates', async () => {
    const t = setup()

    await startPersistentServer(FULL_ENV, t.deps)

    const opts = t.startCron.mock.calls[0][0] as { claim?: unknown }
    expect(opts.claim).toBeUndefined()
    expect(t.text()).toContain('WORKFLOW_POSTGRES_URL')
    expect(t.text()).toMatch(/дважды|дубл/i)
  })

  it('no warning about duplicates when the cron is off', async () => {
    const t = setup()
    await startPersistentServer({ PERSISTENT_SERVER: '1' }, t.deps)
    expect(t.text()).not.toContain('WORKFLOW_POSTGRES_URL')
  })
})

describe('startPersistentServer: signals', () => {
  it('registers SIGTERM and SIGINT on a persistent server, even with nothing else to start', async () => {
    const t = setup()

    await startPersistentServer({ PERSISTENT_SERVER: '1' }, t.deps)

    expect([...t.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])
  })

  it('registers them when the queue or the cron was started', async () => {
    const t = setup()
    await startPersistentServer(FULL_ENV, t.deps)
    expect([...t.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])
  })

  describe('without the Workflow queue', () => {
    it('SIGTERM: stops the cron first, waits for tracked work, then exits 0', async () => {
      const t = setup()
      const work = deferred()
      trackBackground(work.promise)
      await startPersistentServer(NO_QUEUE_ENV, t.deps)

      t.handlers.get('SIGTERM')!()

      // synchronous: the cron stops before anything is waited for
      expect(t.stopCron).toHaveBeenCalledTimes(1)
      await flush()
      expect(t.exit).not.toHaveBeenCalled() // the task is still running

      work.resolve()
      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.exit).toHaveBeenCalledTimes(1)
      expect(t.text()).toContain('ждали 1 задач')
    })

    it('SIGINT does the same', async () => {
      const t = setup()
      await startPersistentServer(NO_QUEUE_ENV, t.deps)

      t.handlers.get('SIGINT')!()

      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.stopCron).toHaveBeenCalledTimes(1)
      expect(t.text()).toContain('ждали 0 задач')
    })

    it('waits at most 55 s for the work', async () => {
      vi.useFakeTimers()
      try {
        const t = setup()
        trackBackground(new Promise<void>(() => {})) // never settles
        await startPersistentServer(NO_QUEUE_ENV, t.deps)

        t.handlers.get('SIGTERM')!()
        await vi.advanceTimersByTimeAsync(54_999)
        expect(t.exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(t.exit).toHaveBeenCalledWith(0)
        expect(t.text()).toContain('ждали 1 задач')
        expect(t.text()).toMatch(/не завершено 1/)
      } finally {
        vi.useRealTimers()
        // the promise above never settles; clear the shared set so the next test starts clean
        delete (globalThis as Record<symbol, unknown>)[Symbol.for('aistart360.background.pending')]
      }
    })

    it('a second signal while shutting down waits and exits only once', async () => {
      const t = setup()
      const work = deferred()
      trackBackground(work.promise)
      await startPersistentServer(NO_QUEUE_ENV, t.deps)

      t.handlers.get('SIGTERM')!()
      t.handlers.get('SIGINT')!()
      t.handlers.get('SIGTERM')!()
      work.resolve()

      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      await flush()
      expect(t.exit).toHaveBeenCalledTimes(1)
      expect(t.stopCron).toHaveBeenCalledTimes(1)
    })

    it('a cron that will not stop does not keep the process from exiting', async () => {
      const t = setup()
      t.stopCron.mockImplementation(() => { throw new Error('stop failed') })
      await startPersistentServer(NO_QUEUE_ENV, t.deps)

      t.handlers.get('SIGTERM')!()

      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.text()).toContain('stop failed')
    })

    it('without a cron there is nothing to stop and the handler still waits and exits', async () => {
      const t = setup()
      await startPersistentServer({ PERSISTENT_SERVER: '1', NEXT_MANUAL_SIG_HANDLE: 'true' }, t.deps)

      t.handlers.get('SIGTERM')!()

      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.stopCron).not.toHaveBeenCalled()
    })
  })

  // graphile-worker (inside the Postgres world) handles the same SIGTERM on its own: it stops taking
  // jobs, lets the running ones finish (or fails them so they are retried at once) and only then
  // re-sends the signal to the process. Exiting before that leaves the running jobs locked for 4 h.
  describe('with the Workflow queue running', () => {
    it('does not exit on the first signal, even with no tracked work: it waits for the re-sent one', async () => {
      const t = setup()
      await bootRunning(t)

      t.handlers.get('SIGTERM')!()
      expect(t.stopCron).toHaveBeenCalledTimes(1)
      await flush()
      expect(t.exit).not.toHaveBeenCalled()

      t.handlers.get('SIGTERM')!() // graphile-worker's process.kill(process.pid, 'SIGTERM')

      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.exit).toHaveBeenCalledTimes(1)
      expect(t.text()).toMatch(/очередь Workflow остановлена/)
    })

    it('exits only when BOTH the tracked work is done and the re-sent signal has arrived (signal first)', async () => {
      const t = setup()
      const work = deferred()
      trackBackground(work.promise)
      await bootRunning(t)

      t.handlers.get('SIGTERM')!()
      t.handlers.get('SIGTERM')!() // the queue is stopped, the work is not
      await flush()
      expect(t.exit).not.toHaveBeenCalled()

      work.resolve()
      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.exit).toHaveBeenCalledTimes(1)
    })

    it('exits only when BOTH the tracked work is done and the re-sent signal has arrived (work first)', async () => {
      const t = setup()
      const work = deferred()
      trackBackground(work.promise)
      await bootRunning(t)

      t.handlers.get('SIGTERM')!()
      work.resolve() // the work is done, the queue is not
      await flush()
      expect(t.exit).not.toHaveBeenCalled()

      t.handlers.get('SIGTERM')!()
      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      expect(t.exit).toHaveBeenCalledTimes(1)
    })

    it('a re-sent signal of the other kind counts too (SIGINT first, SIGTERM after)', async () => {
      const t = setup()
      await bootRunning(t)

      t.handlers.get('SIGINT')!()
      await flush()
      expect(t.exit).not.toHaveBeenCalled()

      t.handlers.get('SIGTERM')!()
      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
    })

    it('further signals after the exit decision do not exit again or stop the cron again', async () => {
      const t = setup()
      await bootRunning(t)

      t.handlers.get('SIGTERM')!()
      t.handlers.get('SIGTERM')!()
      await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
      t.handlers.get('SIGTERM')!()
      t.handlers.get('SIGINT')!()
      await flush()

      expect(t.exit).toHaveBeenCalledTimes(1)
      expect(t.stopCron).toHaveBeenCalledTimes(1)
    })

    it('the shared 55 s deadline still forces exit(0) when the re-sent signal never comes', async () => {
      vi.useFakeTimers()
      try {
        const t = setup()
        await bootRunningFake(t)

        t.handlers.get('SIGTERM')!()
        await vi.advanceTimersByTimeAsync(54_999)
        expect(t.exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(t.exit).toHaveBeenCalledWith(0)
        expect(t.exit).toHaveBeenCalledTimes(1)
        expect(t.text()).toMatch(/не подтвердила остановку|не дождались/)
      } finally {
        vi.useRealTimers()
      }
    })

    it('the deadline is shared: work that ends at 30 s does not extend the wait for the signal past 55 s', async () => {
      vi.useFakeTimers()
      try {
        const t = setup()
        const work = deferred()
        trackBackground(work.promise)
        await bootRunningFake(t)

        t.handlers.get('SIGTERM')!()
        await vi.advanceTimersByTimeAsync(30_000)
        work.resolve()
        await vi.advanceTimersByTimeAsync(24_999)
        expect(t.exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1) // 55 s after the first signal
        expect(t.exit).toHaveBeenCalledWith(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('the deadline also forces exit when the work never ends although the signal came', async () => {
      vi.useFakeTimers()
      try {
        const t = setup()
        trackBackground(new Promise<void>(() => {}))
        await bootRunningFake(t)

        t.handlers.get('SIGTERM')!()
        t.handlers.get('SIGTERM')!()
        await vi.advanceTimersByTimeAsync(54_999)
        expect(t.exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(t.exit).toHaveBeenCalledWith(0)
        expect(t.text()).toMatch(/не завершено 1/)
      } finally {
        vi.useRealTimers()
        delete (globalThis as Record<symbol, unknown>)[Symbol.for('aistart360.background.pending')]
      }
    })

    it('leaves no timer behind once it has exited', async () => {
      vi.useFakeTimers()
      try {
        const t = setup()
        await bootRunningFake(t)

        t.handlers.get('SIGTERM')!()
        t.handlers.get('SIGTERM')!()
        await vi.advanceTimersByTimeAsync(0)

        expect(t.exit).toHaveBeenCalledWith(0)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

// The same build runs as the agents service (PORTAL_ROLE=agents, lib/runtime/role.ts). The Workflow
// queue belongs to the portal: a second service polling it would take a share of the portal's
// workflow jobs. Everything else a persistent server starts, the in-process cron (the service's
// maintenance loop) and the shutdown handler, is the same.
describe('startPersistentServer: the agents role (PORTAL_ROLE=agents)', () => {
  const AGENTS_ENV: Partial<NodeJS.ProcessEnv> = { ...FULL_ENV, PORTAL_ROLE: 'agents' }
  const roleLines = (t: ReturnType<typeof setup>) => t.lines.filter((line) => line.includes('PORTAL_ROLE=agents') && line.includes('Workflow'))

  it('does not start the Workflow queue, even with the Postgres world configured, and says so in one line', async () => {
    const t = setup()

    await expect(startPersistentServer(AGENTS_ENV, t.deps)).resolves.toEqual({ world: false, cron: true })
    await flush()

    expect(t.startWorld).not.toHaveBeenCalled()
    expect(roleLines(t)).toHaveLength(1)
    expect(roleLines(t)[0]).toMatch(/^server: /)
    expect(t.errors).toEqual([]) // it is how the service is meant to run, not a failure
    expect(getWorkflowQueueStatus()).toEqual({ state: 'off', attempts: 0 })
  })

  it('says so when no Workflow world is configured either: the line is the mark of the role in the boot log', async () => {
    const t = setup()

    await expect(startPersistentServer({ ...NO_QUEUE_ENV, PORTAL_ROLE: 'agents' }, t.deps)).resolves.toEqual({ world: false, cron: true })

    expect(roleLines(t)).toHaveLength(1)
    expect(t.startWorld).not.toHaveBeenCalled()
  })

  it('reads the role from the environment it was given, in any spelling', async () => {
    const t = setup()
    await expect(startPersistentServer({ ...FULL_ENV, PORTAL_ROLE: ' Agents ' }, t.deps)).resolves.toEqual({ world: false, cron: true })
    expect(t.startWorld).not.toHaveBeenCalled()
  })

  it('the cron runner starts exactly as in any other role: 127.0.0.1, the PORT, the secret, the claim', async () => {
    const t = setup()
    const env = { ...AGENTS_ENV, WORKFLOW_POSTGRES_URL: 'postgres://user:pw@unreachable.invalid:5432/db' }

    await startPersistentServer(env, t.deps)

    expect(t.startCron).toHaveBeenCalledTimes(1)
    const opts = t.startCron.mock.calls[0][0] as { baseUrl: string; secret: string; claim?: unknown }
    expect(opts).toMatchObject({ baseUrl: 'http://127.0.0.1:8080', secret: 'x' })
    expect(typeof opts.claim).toBe('function')
    expect(t.text()).not.toContain('pw@')
  })

  it('the cron runner is still refused while vercel.json has crons', async () => {
    const t = setup({ cwd: dirWith(VERCEL_WITH_CRONS) })
    await expect(startPersistentServer(AGENTS_ENV, t.deps)).resolves.toEqual({ world: false, cron: false })
    expect(t.startCron).not.toHaveBeenCalled()
  })

  it('SIGTERM: stops the cron first, waits for tracked work, then exits 0 - there is no queue to wait for', async () => {
    const t = setup()
    const work = deferred()
    trackBackground(work.promise)
    await startPersistentServer(AGENTS_ENV, t.deps)
    expect([...t.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])

    t.handlers.get('SIGTERM')!()

    expect(t.stopCron).toHaveBeenCalledTimes(1)
    await flush()
    expect(t.exit).not.toHaveBeenCalled() // an agent task is still running

    work.resolve()
    await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0)) // one signal is enough: no re-sent one is coming
    expect(t.exit).toHaveBeenCalledTimes(1)
    expect(t.text()).toContain('ждали 1 задач')
    expect(t.text()).not.toMatch(/очередь Workflow (остановлена|не подтвердила|не запущена)/)
  })

  it('still waits at most 55 s for the work', async () => {
    vi.useFakeTimers()
    try {
      const t = setup()
      trackBackground(new Promise<void>(() => {})) // a task that never ends
      await startPersistentServer(AGENTS_ENV, t.deps)

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(54_999)
      expect(t.exit).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(t.exit).toHaveBeenCalledWith(0)
      expect(t.text()).toMatch(/не завершено 1/)
    } finally {
      vi.useRealTimers()
      delete (globalThis as Record<symbol, unknown>)[Symbol.for('aistart360.background.pending')]
    }
  })

  it('with the real defaults nothing of the Workflow world is touched', async () => {
    vi.stubEnv('WORKFLOW_POSTGRES_WORKER_CONCURRENCY', undefined)
    runtime.concurrencySeen = []
    try {
      const t = setup()
      const { startWorld: _stub, ...deps } = t.deps

      await expect(startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres', PORTAL_ROLE: 'agents' }, deps)).resolves.toEqual({ world: false, cron: false })
      await flush()

      expect(runtime.concurrencySeen).toEqual([]) // getWorld() was never asked
      expect(process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // Without the in-process cron nothing calls /api/cron/agents: retries, expired leases and
  // scheduled agents would silently never happen. That deserves a loud line at boot.
  it('without the cron runner the log says, as an error, that nothing maintains the agent queue', async () => {
    for (const env of [
      { PERSISTENT_SERVER: '1', PORTAL_ROLE: 'agents' }, // CRON_RUNNER_ENABLED not set
      { PERSISTENT_SERVER: '1', PORTAL_ROLE: 'agents', CRON_RUNNER_ENABLED: '1' }, // no CRON_SECRET
    ]) {
      const t = setup()
      await expect(startPersistentServer(env, t.deps)).resolves.toEqual({ world: false, cron: false })
      const said = t.errors.filter((line) => line.includes('PORTAL_ROLE=agents') && line.includes('CRON_RUNNER_ENABLED'))
      expect(said, JSON.stringify(env)).toHaveLength(1)
    }
  })

  it('with the cron runner started there is no such line', async () => {
    const t = setup()
    await startPersistentServer(AGENTS_ENV, t.deps)
    expect(t.errors).toEqual([])
  })
})

describe('startPersistentServer: the other roles keep the Workflow queue', () => {
  it('PORTAL_ROLE=web starts the queue and the cron like one process for everything', async () => {
    const t = setup()

    await expect(startPersistentServer({ ...FULL_ENV, PORTAL_ROLE: 'web' }, t.deps)).resolves.toEqual({ world: true, cron: true })
    await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))

    expect(t.startWorld).toHaveBeenCalledTimes(1)
    expect(t.text()).not.toContain('PORTAL_ROLE')
  })

  it('an unknown or empty PORTAL_ROLE is one process for everything', async () => {
    for (const role of ['', 'all', 'worker', 'agent']) {
      const t = setup()
      await expect(startPersistentServer({ ...FULL_ENV, PORTAL_ROLE: role }, t.deps), `role=${role}`).resolves.toEqual({ world: true, cron: true })
      expect(t.startWorld).toHaveBeenCalledTimes(1)
      expect(t.text()).not.toContain('PORTAL_ROLE')
    }
  })

  it('the web role without the cron runner gets no line about the agent queue', async () => {
    const t = setup()
    await startPersistentServer({ PERSISTENT_SERVER: '1', NEXT_MANUAL_SIG_HANDLE: 'true', PORTAL_ROLE: 'web' }, t.deps)
    expect(t.text()).not.toContain('PORTAL_ROLE')
  })
})

describe('startPersistentServer: the Next signal handler', () => {
  // Next's own handler is server.close(() => process.exit(0)); left on, it would race the wait above.
  it('warns on a persistent server when NEXT_MANUAL_SIG_HANDLE is not set', async () => {
    const t = setup()

    await startPersistentServer({ PERSISTENT_SERVER: '1' }, t.deps)

    expect(t.text()).toContain('NEXT_MANUAL_SIG_HANDLE')
  })

  it('does not warn when it is set (Next only looks at whether it is non-empty)', async () => {
    for (const value of ['true', '1']) {
      const t = setup()
      await startPersistentServer({ PERSISTENT_SERVER: '1', NEXT_MANUAL_SIG_HANDLE: value }, t.deps)
      expect(t.text(), `value=${value}`).not.toContain('NEXT_MANUAL_SIG_HANDLE')
    }
  })

  it('warns when it is empty', async () => {
    const t = setup()
    await startPersistentServer({ PERSISTENT_SERVER: '1', NEXT_MANUAL_SIG_HANDLE: '' }, t.deps)
    expect(t.text()).toContain('NEXT_MANUAL_SIG_HANDLE')
  })

  it('says nothing when this is not a persistent server', async () => {
    const t = setup()
    await startPersistentServer({}, t.deps)
    expect(t.text()).not.toContain('NEXT_MANUAL_SIG_HANDLE')
  })
})

describe('startPersistentServer: defaults', () => {
  // The production wiring: no stubs, only the logger and exit are kept out of the real process.
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    runtime.world = { start: vi.fn(async () => {}) }
    runtime.concurrencySeen = []
  })

  it('starts the queue through getWorld().start() from workflow/runtime', async () => {
    const start = vi.fn(async () => {})
    runtime.world = { start }
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await expect(startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)).resolves.toEqual({ world: true, cron: false })

    await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))
    expect(start).toHaveBeenCalledTimes(1)
  })

  // The queue's own default is 10 concurrent jobs; the project rule for background work is at most 2.
  it('limits the queue to 2 concurrent jobs when WORKFLOW_POSTGRES_WORKER_CONCURRENCY is unset, before getWorld()', async () => {
    vi.stubEnv('WORKFLOW_POSTGRES_WORKER_CONCURRENCY', undefined)
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)

    await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))
    expect(runtime.concurrencySeen).toEqual(['2'])
  })

  it('treats an empty WORKFLOW_POSTGRES_WORKER_CONCURRENCY as unset', async () => {
    vi.stubEnv('WORKFLOW_POSTGRES_WORKER_CONCURRENCY', '')
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)

    await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))
    expect(runtime.concurrencySeen).toEqual(['2'])
  })

  it('respects an explicit WORKFLOW_POSTGRES_WORKER_CONCURRENCY', async () => {
    vi.stubEnv('WORKFLOW_POSTGRES_WORKER_CONCURRENCY', '5')
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)

    await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))
    expect(runtime.concurrencySeen).toEqual(['5'])
  })

  it('leaves the variable alone when the queue is not started', async () => {
    vi.stubEnv('WORKFLOW_POSTGRES_WORKER_CONCURRENCY', undefined)
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await startPersistentServer({ PERSISTENT_SERVER: '1' }, deps)

    expect(process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY).toBeUndefined()
    expect(runtime.concurrencySeen).toEqual([])
  })

  it('a world without a start() is not an error', async () => {
    runtime.world = {}
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await expect(startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)).resolves.toEqual({ world: true, cron: false })
    await vi.waitFor(() => expect(getWorkflowQueueStatus().state).toBe('running'))
  })

  it('the signal handlers are permanent process listeners, not once-only', async () => {
    // graphile-worker re-sends SIGTERM to the process after its own graceful stop; a once-only
    // handler would already be gone and that signal would end the process mid-wait.
    const on = vi.spyOn(process, 'on').mockImplementation((() => process) as unknown as typeof process.on)
    const once = vi.spyOn(process, 'once').mockImplementation((() => process) as unknown as typeof process.once)
    const t = setup()
    const { onSignal: _stub, ...deps } = t.deps

    await startPersistentServer({ PERSISTENT_SERVER: '1' }, deps)

    expect(on.mock.calls.map(([event]) => event).sort()).toEqual(['SIGINT', 'SIGTERM'])
    expect(once).not.toHaveBeenCalled()
  })

  it('reads vercel.json from process.cwd()', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dirWith(VERCEL_WITH_CRONS))
    const t = setup()
    const { cwd: _stub, ...deps } = t.deps

    await expect(startPersistentServer(NO_QUEUE_ENV, deps)).resolves.toEqual({ world: false, cron: false })
    expect(t.startCron).not.toHaveBeenCalled()
  })

  it('a failed queue start goes to console.error', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const t = setup()
      t.startWorld.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
      const { logError: _stub, ...deps } = t.deps

      await startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)
      await vi.advanceTimersByTimeAsync(0)

      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0][0])).toContain('ECONNREFUSED')
    } finally {
      vi.useRealTimers()
    }
  })
})
