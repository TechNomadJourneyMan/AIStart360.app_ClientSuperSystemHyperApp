/**
 * RA-1 (review of R4-A2) — after a 504 the late handler keeps running and sees its deadline spent
 * (so it stops). But the work it hands to the background — runInBackground (AI hypotheses, the paid
 * AI catch-up, the «Сообщения» mirror) and the webhooks' queue fast path (the client's auto-reply) —
 * inherited that spent deadline through AsyncLocalStorage: every AI call there was refused at once
 * («истёк общий лимит времени ответа ИИ», 0 attempts) and every inngest.send failed without a request.
 * Background work now starts outside the request's deadline (detachDeadline).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServer, type Server } from 'node:http'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ProviderTarget } from '@/lib/ai/providers/types'

beforeAll(() => {
  // Next puts AsyncLocalStorage on globalThis (both runtimes); vitest does not.
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
})

const { withDeadline, runWithDeadline, detachDeadline, deadlineRemainingMs, currentDeadline } = await import('@/lib/runtime/deadline')
const { runInBackground, waitForBackgroundWork } = await import('@/lib/background')
const { runWithFailover } = await import('@/lib/ai/providers/failover')
const { createInngestClient } = await import('@/lib/inngest')

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const target = { providerKey: 'p', model: 'm', credentialId: null } as unknown as ProviderTarget

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

/** A route whose handler answers after its deadline and hands `work` to the background on the way. */
function lateRoute(work: () => Promise<unknown>) {
  return withDeadline(async () => {
    await wait(60)
    void runInBackground('late-work', work)
    return new Response('late')
  }, { label: 'late-route', ms: 20, log: () => {} })
}

describe('RA-1: work handed to the background after a 504 is not bound by the spent deadline', () => {
  it('detachDeadline: no deadline inside, even within a spent one', async () => {
    let inside: number | null = -1
    await runWithDeadline('spent', 10, async () => {
      await wait(30)
      expect(deadlineRemainingMs()).toBe(0) // the late work itself sees it spent
      inside = detachDeadline(() => deadlineRemainingMs())
    })
    expect(inside).toBeNull()
  })

  it('an AI call in runInBackground started by a late handler gets its attempts (before: 0 attempts, refused)', async () => {
    let seen: number | null = -1
    let attempts = -1
    let ok: boolean | null = null
    const handler = lateRoute(async () => {
      await wait(10)
      seen = deadlineRemainingMs()
      const run = await runWithFailover([target], async () => ({ ok: true as const }), { deadlineMs: 5_000 })
      attempts = run.attempts
      ok = run.ok
    })

    expect((await handler(new Request('http://x/'), {})).status).toBe(504)
    await wait(80) // the late handler finishes and starts the background work
    await waitForBackgroundWork(2_000)

    expect(seen).toBeNull()
    expect(ok).toBe(true)
    expect(attempts).toBe(1)
  })

  it('an inngest.send in runInBackground started by a late handler reaches a healthy Inngest', async () => {
    let requests = 0
    const server: Server = createServer((req, res) => {
      requests += 1
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ids: ['evt-1'], status: 200 }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const port = (server.address() as { port: number }).port
    const client = createInngestClient({
      INNGEST_SELF_HOSTED_URL: `http://127.0.0.1:${port}`,
      INNGEST_SELF_EVENT_KEY: 'k',
      INNGEST_SELF_SIGNING_KEY: 'abcdef0123456789abcdef0123456789',
    } as unknown as NodeJS.ProcessEnv)

    let outcome: unknown = null
    const handler = lateRoute(async () => {
      outcome = await client.send({ name: 'test/late', data: {} }).then((r) => r.ids, (e: unknown) => e)
    })
    expect((await handler(new Request('http://x/'), {})).status).toBe(504)
    await wait(80)
    await waitForBackgroundWork(5_000)

    expect(outcome).toEqual(['evt-1'])
    expect(requests).toBe(1)
  })

  it('the late handler itself still sees its deadline spent (it must stop, not start new work)', async () => {
    let lateSignal: AbortSignal | null = null
    const handler = withDeadline(async () => {
      await wait(60)
      lateSignal = currentDeadline()?.signal ?? null
      return new Response('late')
    }, { label: 'late-route', ms: 20, log: () => {} })
    expect((await handler(new Request('http://x/'), {})).status).toBe(504)
    await wait(80)
    expect(lateSignal!.aborted).toBe(true)
  })
})
