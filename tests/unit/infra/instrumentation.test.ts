/**
 * instrumentation.ts — Next calls register() once at boot, on Vercel as well. It must do nothing
 * there (and on the Edge runtime), and start the persistent-server work only on Railway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({ startPersistentServer: vi.fn(async () => ({ world: false, cron: false })) }))
vi.mock('@/lib/runtime/server-start', () => ({ startPersistentServer: server.startPersistentServer }))

import { register } from '@/instrumentation'

beforeEach(() => {
  server.startPersistentServer.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
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
