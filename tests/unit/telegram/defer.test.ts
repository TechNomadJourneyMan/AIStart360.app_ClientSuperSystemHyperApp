/**
 * deferOrAwait — where the bots' update handling runs relative to the 200 answer to Telegram:
 *   • Vercel: waitUntil keeps the function alive (covered in bot-brain.test.ts);
 *   • persistent server (PERSISTENT_SERVER=1): the handling is tracked in the background set, the
 *     route answers at once, SIGTERM waits for it;
 *   • anything else (tests, next dev): awaited before the answer, the old synchronous behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pendingBackgroundCount, waitForBackgroundWork } from '@/lib/background'
import { deferOrAwait } from '@/lib/telegram/bots/defer'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  await waitForBackgroundWork(1000)
  vi.unstubAllEnvs()
})

describe('deferOrAwait on a persistent server', () => {
  it('answers at once and keeps the work in the background set', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    const done = vi.fn()
    const work = sleep(50).then(done)

    const started = Date.now()
    const mode = await deferOrAwait(work)

    expect(mode).toBe('deferred')
    expect(Date.now() - started).toBeLessThan(20)
    expect(done).not.toHaveBeenCalled()
    expect(pendingBackgroundCount()).toBe(1)

    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('never rejects when the work fails', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')

    await expect(deferOrAwait(Promise.reject(new Error('boom')))).resolves.toBe('deferred')
    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
  })
})

describe('deferOrAwait without a flag', () => {
  it('awaits the work before answering, as before', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '')
    const done = vi.fn()
    const work = sleep(50).then(done)

    const mode = await deferOrAwait(work)

    expect(mode).toBe('awaited')
    expect(done).toHaveBeenCalledTimes(1)
    expect(pendingBackgroundCount()).toBe(0)
  })

  it('does not treat PERSISTENT_SERVER=0 as a persistent server', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '0')
    const done = vi.fn()

    expect(await deferOrAwait(sleep(20).then(done))).toBe('awaited')
    expect(done).toHaveBeenCalledTimes(1)
  })
})
