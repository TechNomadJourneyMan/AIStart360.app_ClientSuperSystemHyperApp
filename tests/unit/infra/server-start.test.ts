/**
 * lib/runtime/server-start.ts — what a persistent server (Railway) starts when it boots: the
 * Workflow queue, the in-process cron, and the SIGTERM handler that lets after-response work
 * finish before the process exits. Every dependency is a stub; nothing here touches a database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ world: { start: vi.fn(async () => {}) } as { start?: () => Promise<void> } }))
vi.mock('workflow/runtime', () => ({ getWorld: () => runtime.world }))

import { startPersistentServer } from '@/lib/runtime/server-start'
import { trackBackground, waitForBackgroundWork } from '@/lib/background'

type Handler = () => void

const FULL_ENV: Partial<NodeJS.ProcessEnv> = {
  PERSISTENT_SERVER: '1',
  WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
  CRON_RUNNER_ENABLED: '1',
  CRON_SECRET: 'x',
  PORT: '8080',
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

function setup() {
  const lines: string[] = []
  const stopCron = vi.fn()
  const handlers = new Map<string, Handler>()
  const startWorld = vi.fn(async () => {})
  const startCron = vi.fn((_opts: unknown) => ({ stop: stopCron }))
  const onSignal = vi.fn((sig: 'SIGTERM' | 'SIGINT', handler: Handler) => { handlers.set(sig, handler) })
  const exit = vi.fn((_code: number) => {})
  const deps = {
    startWorld,
    startCron: startCron as unknown as NonNullable<Parameters<typeof startPersistentServer>[1]>['startCron'],
    onSignal,
    exit,
    log: (line: string) => { lines.push(line) },
  }
  return { deps, lines, stopCron, handlers, startWorld, startCron, onSignal, exit, text: () => lines.join('\n') }
}

afterEach(async () => {
  // a test must not leave tracked work behind for the next one
  await waitForBackgroundWork(1000)
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

  it('a queue that cannot start fails the boot: it is logged and rethrown, and nothing else starts', async () => {
    const t = setup()
    t.startWorld.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'))

    await expect(startPersistentServer(FULL_ENV, t.deps)).rejects.toThrow('ECONNREFUSED')

    expect(t.text()).toContain('ECONNREFUSED')
    expect(t.startCron).not.toHaveBeenCalled()
    expect(t.onSignal).not.toHaveBeenCalled()
  })

  it('never logs the cron secret', async () => {
    const t = setup()
    await startPersistentServer({ ...FULL_ENV, CRON_SECRET: 'very-secret-value' }, t.deps)
    expect(t.text()).not.toContain('very-secret-value')
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

  it('SIGTERM: stops the cron first, waits for tracked work, then exits 0', async () => {
    const t = setup()
    const work = deferred()
    trackBackground(work.promise)
    await startPersistentServer(FULL_ENV, t.deps)

    t.handlers.get('SIGTERM')!()

    // synchronous: the cron stops before anything is waited for
    expect(t.stopCron).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(t.exit).not.toHaveBeenCalled() // the task is still running

    work.resolve()
    await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
    expect(t.exit).toHaveBeenCalledTimes(1)
    expect(t.text()).toContain('ждали 1 задач')
  })

  it('SIGINT does the same', async () => {
    const t = setup()
    await startPersistentServer(FULL_ENV, t.deps)

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
      await startPersistentServer(FULL_ENV, t.deps)

      t.handlers.get('SIGTERM')!()
      await vi.advanceTimersByTimeAsync(54_999)
      expect(t.exit).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(t.exit).toHaveBeenCalledWith(0)
      expect(t.text()).toContain('ждали 1 задач')
      expect(t.text()).toMatch(/не завершено 1|не успели/i)
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
    await startPersistentServer(FULL_ENV, t.deps)

    t.handlers.get('SIGTERM')!()
    t.handlers.get('SIGINT')!()
    t.handlers.get('SIGTERM')!()
    work.resolve()

    await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(t.exit).toHaveBeenCalledTimes(1)
    expect(t.stopCron).toHaveBeenCalledTimes(1)
  })

  it('a cron that will not stop does not keep the process from exiting', async () => {
    const t = setup()
    t.stopCron.mockImplementation(() => { throw new Error('stop failed') })
    await startPersistentServer(FULL_ENV, t.deps)

    t.handlers.get('SIGTERM')!()

    await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
    expect(t.text()).toContain('stop failed')
  })

  it('without a cron there is nothing to stop and the handler still waits and exits', async () => {
    const t = setup()
    await startPersistentServer({ PERSISTENT_SERVER: '1' }, t.deps)

    t.handlers.get('SIGTERM')!()

    await vi.waitFor(() => expect(t.exit).toHaveBeenCalledWith(0))
    expect(t.stopCron).not.toHaveBeenCalled()
  })
})

describe('startPersistentServer: defaults', () => {
  // The production wiring: no stubs, only the logger and exit are kept out of the real process.
  afterEach(() => {
    vi.restoreAllMocks()
    runtime.world = { start: vi.fn(async () => {}) }
  })

  it('starts the queue through getWorld().start() from workflow/runtime', async () => {
    const start = vi.fn(async () => {})
    runtime.world = { start }
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await expect(startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)).resolves.toEqual({ world: true, cron: false })

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('a world without a start() is not an error', async () => {
    runtime.world = {}
    const t = setup()
    const { startWorld: _stub, ...deps } = t.deps

    await expect(startPersistentServer({ WORKFLOW_TARGET_WORLD: '@workflow/world-postgres' }, deps)).resolves.toEqual({ world: true, cron: false })
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
})
