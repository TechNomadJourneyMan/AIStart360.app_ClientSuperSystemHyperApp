/**
 * instrumentation.ts — Next calls register() once at boot, on Vercel as well. On every Node server
 * it puts the Supabase transport over globalThis.fetch; the persistent-server work starts only on
 * Railway. On the Edge runtime it does nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({ startPersistentServer: vi.fn(async () => ({ world: false, cron: false })) }))
vi.mock('@/lib/runtime/server-start', () => ({ startPersistentServer: server.startPersistentServer }))

import { register } from '@/instrumentation'

const TRANSPORT_MARKER = Symbol.for('aistart360.supabaseTransport')
const isTransport = (fn: unknown) => (fn as Record<symbol, unknown>)[TRANSPORT_MARKER] === true

beforeEach(() => {
  server.startPersistentServer.mockReset()
  server.startPersistentServer.mockImplementation(async () => ({ world: false, cron: false }))
  // register() replaces globalThis.fetch on the Node runtime: give it a fetch of the test's own, so
  // nothing can reach the network and afterEach takes the wrapper off again.
  vi.stubEnv('SUPABASE_INTERNAL_URL', '')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('register()', () => {
  it('does nothing on the Edge runtime, even with PERSISTENT_SERVER=1', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    vi.stubEnv('PERSISTENT_SERVER', '1')

    await register()

    expect(server.startPersistentServer).not.toHaveBeenCalled()
  })

  it('starts no persistent-server work on Vercel (node runtime, no PERSISTENT_SERVER)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('PERSISTENT_SERVER', '')

    await register()

    expect(server.startPersistentServer).not.toHaveBeenCalled()
  })

  it('does nothing when NEXT_RUNTIME is not set at all', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('NEXT_RUNTIME', '')

    await register()

    expect(server.startPersistentServer).not.toHaveBeenCalled()
  })

  it('starts the persistent server work on the node runtime with PERSISTENT_SERVER=1', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')

    await register()

    expect(server.startPersistentServer).toHaveBeenCalledTimes(1)
    expect(server.startPersistentServer).toHaveBeenCalledWith(process.env)
  })
})

// Every Node server gets the retrying Supabase transport (lib/supabase/transport.ts): some 270 call
// sites build their client inline and all of them end in globalThis.fetch. The Edge runtime has a
// global scope of its own; middleware takes the wrapper explicitly (lib/supabase/transport-edge.ts).
describe('register(): Supabase transport', () => {
  it('puts the wrapper over globalThis.fetch on the Node runtime, once', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '')
    const before = globalThis.fetch

    await register()

    const installed = globalThis.fetch
    expect(installed).not.toBe(before)
    expect(isTransport(installed)).toBe(true)

    await register()

    expect(globalThis.fetch).toBe(installed)
    expect(server.startPersistentServer).not.toHaveBeenCalled()
  })

  it('is in place before the persistent-server work starts', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    let wrappedAtStart = false
    server.startPersistentServer.mockImplementation(async () => {
      wrappedAtStart = isTransport(globalThis.fetch)
      return { world: false, cron: false }
    })

    await register()

    expect(wrappedAtStart).toBe(true)
  })

  it('does not touch globalThis.fetch on the Edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const before = globalThis.fetch

    await register()

    expect(globalThis.fetch).toBe(before)
    expect(isTransport(globalThis.fetch)).toBe(false)
  })

  it('does not touch globalThis.fetch when NEXT_RUNTIME is not set at all', async () => {
    vi.stubEnv('NEXT_RUNTIME', '')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const before = globalThis.fetch

    await register()

    expect(globalThis.fetch).toBe(before)
  })

  it('a wrapper that cannot be installed is reported and does not stop the boot', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = globalThis.fetch
    vi.resetModules()
    vi.doMock('@/lib/supabase/transport', () => ({
      installSupabaseTransport: () => {
        throw new Error('fetch is frozen')
      },
    }))
    try {
      const fresh = await import('@/instrumentation')

      await fresh.register()

      expect(globalThis.fetch).toBe(before)
      expect(String(error.mock.calls[0]?.[0])).toContain('fetch is frozen')
      // the rest of the boot goes on as before
      expect(server.startPersistentServer).toHaveBeenCalledTimes(1)
      expect(exit).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('@/lib/supabase/transport')
      vi.resetModules()
    }
  })
})

// Next drops an error with code MODULE_NOT_FOUND thrown from register() without a word
// (next-server.js prepareImpl): the server would then run with no queue, no cron and no SIGTERM
// handler. On a persistent server any failure here is logged and ends the process instead.
describe('register(): a failed start on a persistent server', () => {
  function stubProcess() {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    return { exit, error }
  }

  it('startPersistentServer rejecting with MODULE_NOT_FOUND: logged, exit(1)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const { exit, error } = stubProcess()
    server.startPersistentServer.mockRejectedValueOnce(
      Object.assign(new Error("Cannot find module 'workflow/runtime'"), { code: 'MODULE_NOT_FOUND' }),
    )

    await register()

    expect(exit).toHaveBeenCalledWith(1)
    expect(String(error.mock.calls[0]?.[0])).toContain("Cannot find module 'workflow/runtime'")
  })

  it('any other failure of the start: logged, exit(1)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const { exit, error } = stubProcess()
    server.startPersistentServer.mockRejectedValueOnce(new Error('boom'))

    await register()

    expect(exit).toHaveBeenCalledWith(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('boom')
  })

  it('the dynamic import of server-start failing: logged, exit(1)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const { exit, error } = stubProcess()
    vi.resetModules()
    vi.doMock('@/lib/runtime/server-start', () => {
      throw Object.assign(new Error("Cannot find module 'pg'"), { code: 'MODULE_NOT_FOUND' })
    })
    try {
      const fresh = await import('@/instrumentation')

      await fresh.register()

      expect(exit).toHaveBeenCalledWith(1)
      expect(error).toHaveBeenCalled()
    } finally {
      // back to the file-wide stub for the tests after this one
      vi.doMock('@/lib/runtime/server-start', () => ({ startPersistentServer: server.startPersistentServer }))
      vi.resetModules()
    }
  })

  it('a successful start does not exit', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const { exit, error } = stubProcess()

    await register()

    expect(exit).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('on Vercel nothing is started, so nothing can fail or exit', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('PERSISTENT_SERVER', '')
    const { exit } = stubProcess()
    server.startPersistentServer.mockRejectedValue(new Error('boom'))

    await register()

    expect(exit).not.toHaveBeenCalled()
  })
})
