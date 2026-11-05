/**
 * lib/background.ts — the set of after-response work that is still running. A persistent server
 * (Railway) waits for it on SIGTERM so a redeploy does not cut a bot answer or a queue drain short.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pendingBackgroundCount, runInBackground, trackBackground, waitForBackgroundWork } from '@/lib/background'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

afterEach(async () => {
  // nothing may leak into the next test through the module-level set
  await waitForBackgroundWork(1000)
  delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT]
  vi.restoreAllMocks()
})

describe('trackBackground / waitForBackgroundWork', () => {
  it('counts the promises that have not settled yet and drops them as they finish', async () => {
    expect(pendingBackgroundCount()).toBe(0)
    trackBackground(sleep(10))
    trackBackground(sleep(50))
    expect(pendingBackgroundCount()).toBe(2)

    await sleep(30)
    expect(pendingBackgroundCount()).toBe(1)

    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
    expect(pendingBackgroundCount()).toBe(0)
  })

  it('reports finished at once when there is nothing to wait for', async () => {
    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
  })

  it('gives up at the timeout and reports what is still running', async () => {
    const stuck = deferred()
    trackBackground(stuck.promise)

    const started = Date.now()
    await expect(waitForBackgroundWork(30)).resolves.toEqual({ finished: false, pending: 1 })
    expect(Date.now() - started).toBeLessThan(500)

    stuck.resolve()
    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
  })

  it('does not throw when a tracked promise rejects', async () => {
    trackBackground(Promise.reject(new Error('boom')))
    trackBackground(sleep(10))

    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
    expect(pendingBackgroundCount()).toBe(0)
  })

  it('also waits for work that was started while it was waiting', async () => {
    trackBackground(sleep(10).then(() => { trackBackground(sleep(30)) }))

    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
  })

  it('registers the promise with the Vercel request context when there is one', async () => {
    const waitUntil = vi.fn()
    ;(globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) }
    const work = sleep(5)

    trackBackground(work)

    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledWith(work)
    expect(pendingBackgroundCount()).toBe(1)
  })

  it('works without a request context (local, tests, persistent server)', () => {
    expect(() => trackBackground(sleep(5))).not.toThrow()
  })
})

describe('runInBackground', () => {
  it('is tracked while it runs and never rejects', async () => {
    const stuck = deferred()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const running = runInBackground('ok', () => stuck.promise)
    const failing = runInBackground('bad', async () => { throw new Error('nope') })

    expect(pendingBackgroundCount()).toBeGreaterThanOrEqual(1)
    await expect(failing).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[background:bad]', 'nope')

    stuck.resolve()
    await expect(running).resolves.toBeUndefined()
    await expect(waitForBackgroundWork(1000)).resolves.toEqual({ finished: true, pending: 0 })
  })
})
