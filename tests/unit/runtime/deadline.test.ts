/**
 * R-015 — lib/runtime/deadline.ts: `next start` on Railway ignores `export const maxDuration`, so a
 * route has no time limit. withDeadline answers 504 when the handler is late and aborts the
 * deadline signal; the ambient deadline bounds the work below the handler (the AI failover).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  // Next puts AsyncLocalStorage on globalThis (next/dist/server/node-environment.js); vitest does not.
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
})

const { envMs, withDeadline, runWithDeadline, deadlineRemainingMs, currentDeadline, DeadlineExceededError } = await import('@/lib/runtime/deadline')

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  delete process.env.ROUTE_DEADLINE_DISABLED
  delete process.env.ROUTE_DEADLINE_MS_SLOW_ROUTE
})

describe('R-015 envMs', () => {
  it('reads a positive integer, falls back on junk, 0 only when allowed', () => {
    expect(envMs('X', 100, { env: { X: '2500' } })).toBe(2500)
    expect(envMs('X', 100, { env: { X: 'abc' } })).toBe(100)
    expect(envMs('X', 100, { env: { X: '-5' } })).toBe(100)
    expect(envMs('X', 100, { env: {} })).toBe(100)
    expect(envMs('X', 100, { env: { X: '0' } })).toBe(100)
    expect(envMs('X', 100, { env: { X: '0' }, allowZero: true })).toBe(0)
  })
})

describe('R-015 withDeadline', () => {
  it('passes a timely response through untouched', async () => {
    const ok = new Response('fine', { status: 201 })
    const handler = withDeadline(async () => ok, { label: 'fast', ms: 200, log: () => {} })
    expect(await handler(new Request('http://x/'), {})).toBe(ok)
  })

  it('answers 504 DEADLINE_EXCEEDED when the handler is late and aborts the deadline signal', async () => {
    const lines: string[] = []
    let seenSignal: AbortSignal | null = null
    const handler = withDeadline(async () => {
      seenSignal = currentDeadline()?.signal ?? null
      await wait(200)
      return new Response('late')
    }, { label: 'slow-route', ms: 30, log: (l) => lines.push(l) })

    const started = Date.now()
    const res = await handler(new Request('http://x/'), {})
    expect(Date.now() - started).toBeLessThan(150)
    expect(res.status).toBe(504)
    expect(await res.json()).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' })
    expect(seenSignal!.aborted).toBe(true)
    expect(seenSignal!.reason).toBeInstanceOf(DeadlineExceededError)
    expect(lines.some((l) => l.includes('route_deadline_exceeded') && l.includes('slow-route'))).toBe(true)
  })

  it('does not cut a streamed body: the budget covers the time to the Response only', async () => {
    const handler = withDeadline(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          await wait(80)
          controller.enqueue(new TextEncoder().encode('data: late chunk\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }, { label: 'sse', ms: 30, log: () => {} })
    const res = await handler(new Request('http://x/'), {})
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('late chunk')
  })

  it('reads ROUTE_DEADLINE_MS_<LABEL> and can be switched off with ROUTE_DEADLINE_DISABLED=1', async () => {
    process.env.ROUTE_DEADLINE_MS_SLOW_ROUTE = '500'
    const handler = withDeadline(async () => { await wait(60); return new Response('ok') }, { label: 'slow-route', ms: 10, log: () => {} })
    expect((await handler(new Request('http://x/'), {})).status).toBe(200)
    delete process.env.ROUTE_DEADLINE_MS_SLOW_ROUTE
    process.env.ROUTE_DEADLINE_DISABLED = '1'
    expect((await handler(new Request('http://x/'), {})).status).toBe(200)
  })

  it('logs (does not throw) an error the late handler raises after the 504', async () => {
    const lines: string[] = []
    const handler = withDeadline(async () => { await wait(50); throw new TypeError('boom') }, { label: 'late-error', ms: 10, log: (l) => lines.push(l) })
    expect((await handler(new Request('http://x/'), {})).status).toBe(504)
    await wait(80)
    expect(lines.some((l) => l.includes('route_deadline_late_error') && l.includes('TypeError'))).toBe(true)
  })
})

describe('R-015 ambient deadline', () => {
  it('is visible below the handler and never extended by a nested one', async () => {
    expect(deadlineRemainingMs()).toBeNull()
    await runWithDeadline('outer', 1_000, async () => {
      const outer = deadlineRemainingMs()!
      expect(outer).toBeGreaterThan(900)
      await runWithDeadline('inner', 60_000, async () => {
        expect(deadlineRemainingMs()!).toBeLessThanOrEqual(outer)
      })
      await runWithDeadline('inner-short', 100, async () => {
        expect(deadlineRemainingMs()!).toBeLessThanOrEqual(100)
      })
    })
    expect(deadlineRemainingMs()).toBeNull()
  })
})
