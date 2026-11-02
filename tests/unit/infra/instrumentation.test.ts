/**
 * instrumentation.ts — Next calls register() once at boot, on Vercel as well. It must do nothing
 * there (and on the Edge runtime), and start the persistent-server work only on Railway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({ startPersistentServer: vi.fn(async () => ({ world: false, cron: false })) }))
vi.mock('@/lib/runtime/server-start', () => ({ startPersistentServer: server.startPersistentServer }))

import { register } from '@/instrumentation'

beforeEach(() => {
  server.startPersistentServer.mockReset()
  server.startPersistentServer.mockImplementation(async () => ({ world: false, cron: false }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('register()', () => {
  it('does nothing on the Edge runtime, even with PERSISTENT_SERVER=1', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    vi.stubEnv('PERSISTENT_SERVER', '1')

    await register()

    expect(server.startPersistentServer).not.toHaveBeenCalled()
  })

  it('does nothing on Vercel (node runtime, no PERSISTENT_SERVER)', async () => {
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
