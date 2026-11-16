/**
 * N4A-1 (R4-A2) — lib/inngest.ts: the SDK sends an event with a bare `fetch` and tries up to 5 times
 * (inngest 4.1 `_send`, `retryWithBackoff`). An Inngest server that accepts the connection and never
 * answers held every webhook, «Сообщения» and the Point A queue that awaited `inngest.send` — without end.
 * Now every request of the client has a timeout, one send ends within its budget (or the request's
 * own deadline), and the sync (PUT /api/inngest → register) and the calls a running function makes
 * keep a longer, separate timeout.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServer, type Server, type Socket } from 'node:net'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

beforeAll(() => {
  // Next puts AsyncLocalStorage on globalThis (both runtimes); vitest does not.
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
})

const { createInngestClient, boundedInngestFetch, InngestSendTimeoutError, INNGEST_EVENT_ATTEMPT_MS, INNGEST_API_REQUEST_MS, INNGEST_SEND_TOTAL_MS } = await import('@/lib/inngest')
const { runWithDeadline } = await import('@/lib/runtime/deadline')

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

/** A server that accepts every connection and never says a word (a hung Inngest). */
async function silentServer(): Promise<{ port: number; connections: () => number }> {
  const sockets = new Set<Socket>()
  let count = 0
  const server: Server = createServer((socket) => {
    count += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => {
    for (const s of sockets) s.destroy()
    server.close(() => resolve())
  }))
  return { port: (server.address() as { port: number }).port, connections: () => count }
}

const env = (vars: Record<string, string>) => ({ ...vars }) as unknown as NodeJS.ProcessEnv
const selfHosted = (port: number, extra: Record<string, string> = {}) => env({
  INNGEST_SELF_HOSTED_URL: `http://127.0.0.1:${port}`,
  INNGEST_SELF_EVENT_KEY: 'test-event-key',
  INNGEST_SELF_SIGNING_KEY: 'abcdef0123456789abcdef0123456789',
  ...extra,
})

describe('N4A-1 the defaults', () => {
  it('an event attempt 5–8 s, all attempts of a send ≤ 15 s, other requests bounded but longer', () => {
    expect(INNGEST_EVENT_ATTEMPT_MS).toBeGreaterThanOrEqual(5_000)
    expect(INNGEST_EVENT_ATTEMPT_MS).toBeLessThanOrEqual(8_000)
    expect(INNGEST_SEND_TOTAL_MS).toBeLessThanOrEqual(15_000)
    // below the webhooks' own 30 s deadline: the webhook still answers 500 itself (provider retries)
    expect(INNGEST_SEND_TOTAL_MS).toBeLessThan(30_000)
    expect(INNGEST_API_REQUEST_MS).toBeGreaterThan(INNGEST_EVENT_ATTEMPT_MS)
  })
})

describe('N4A-1 inngest.send against a server that never answers', () => {
  it('fails within its budget instead of hanging, and stops trying', async () => {
    const silent = await silentServer()
    const client = createInngestClient(selfHosted(silent.port, { INNGEST_FETCH_TIMEOUT_MS: '200', INNGEST_SEND_TIMEOUT_MS: '700' }))

    const started = Date.now()
    const err = await client.send({ name: 'test/event', data: { x: 1 } }).then(() => null, (e: unknown) => e)
    const took = Date.now() - started

    expect(err).toBeInstanceOf(InngestSendTimeoutError)
    expect(took).toBeGreaterThanOrEqual(650)
    expect(took).toBeLessThan(1_500)
    // the SDK's retries ran into the per-attempt timeout; none of them outlived the budget for long
    const atBudget = silent.connections()
    expect(atBudget).toBeGreaterThanOrEqual(2)
    await new Promise((r) => setTimeout(r, 600))
    expect(silent.connections()).toBeLessThanOrEqual(5)
  })

  it('each attempt is cut at its own timeout even with a large total budget (the SDK retries up to 5 times)', async () => {
    const silent = await silentServer()
    const client = createInngestClient(selfHosted(silent.port, { INNGEST_FETCH_TIMEOUT_MS: '100', INNGEST_SEND_TIMEOUT_MS: '60000' }))

    const started = Date.now()
    const err = await client.send({ name: 'test/event', data: {} }).then(() => null, (e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(InngestSendTimeoutError)
    // 5 × 100 ms + the SDK's backoff (≈ 1.5–1.9 s), never the platform's 300 s
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(silent.connections()).toBe(5)
  })

  it('a nearer deadline of the request it runs in wins (a webhook\'s 30 s)', async () => {
    const silent = await silentServer()
    const client = createInngestClient(selfHosted(silent.port, { INNGEST_FETCH_TIMEOUT_MS: '5000', INNGEST_SEND_TIMEOUT_MS: '15000' }))

    const started = Date.now()
    const err = await runWithDeadline('webhook', 300, () => client.send({ name: 'test/event', data: {} })).then(() => null, (e: unknown) => e)

    expect(err).toBeInstanceOf(InngestSendTimeoutError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('N4A-1 the bounded fetch', () => {
  /** A fetch that never answers on its own: it settles only when its signal aborts. */
  const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  })

  async function timeToAbort(url: string, method: string, vars: Record<string, string>): Promise<number> {
    const f = boundedInngestFetch(hanging, env(vars))
    const started = Date.now()
    await f(url, { method }).catch(() => undefined)
    return Date.now() - started
  }

  it('an event send gets the short timeout; the register call of the sync, checkpoints and reads the long one', async () => {
    const vars = { INNGEST_FETCH_TIMEOUT_MS: '50', INNGEST_API_TIMEOUT_MS: '400' }
    expect(await timeToAbort('http://inngest.internal:8288/e/key', 'POST', vars)).toBeLessThan(300)
    const register = await timeToAbort('http://inngest.internal:8288/fn/register', 'POST', vars)
    expect(register).toBeGreaterThanOrEqual(350)
    expect(register).toBeLessThan(1_000)
    expect(await timeToAbort('http://inngest.internal:8288/v1/checkpoint/run-1/async', 'POST', vars)).toBeGreaterThanOrEqual(350)
    expect(await timeToAbort('http://inngest.internal:8288/v0/runs/run-1/actions', 'GET', vars)).toBeGreaterThanOrEqual(350)
  })

  it('keeps the caller\'s own signal', async () => {
    const f = boundedInngestFetch(hanging, env({}))
    const controller = new AbortController()
    const pending = f('http://inngest.internal:8288/e/key', { method: 'POST', signal: controller.signal })
    controller.abort(new Error('caller gave up'))
    await expect(pending).rejects.toThrow('caller gave up')
  })

  it('passes the request through untouched otherwise', async () => {
    let seen: { url: string; method?: string; body?: unknown } | null = null
    const f = boundedInngestFetch(async (input, init) => {
      seen = { url: String(input), method: init?.method, body: init?.body }
      return new Response('{"status":200,"ids":["e1"]}', { status: 200 })
    }, env({}))
    const res = await f('http://inngest.internal:8288/e/key', { method: 'POST', body: '[]' })
    expect(res.status).toBe(200)
    expect(seen).toEqual({ url: 'http://inngest.internal:8288/e/key', method: 'POST', body: '[]' })
  })
})

describe('N4A-1 the sync (PUT /api/inngest) still works through the bounded fetch', () => {
  it('registers with an Inngest server that answers slower than an event attempt may take', async () => {
    const seen: string[] = []
    const server: HttpServer = createHttpServer((req, res) => {
      seen.push(`${req.method} ${req.url?.split('?')[0]}`)
      req.resume()
      req.on('end', () => {
        // slower than the event-send timeout below: the register call must not be cut by it
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, modified: true }))
        }, 300)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const port = (server.address() as { port: number }).port

    const client = createInngestClient(selfHosted(port, { INNGEST_FETCH_TIMEOUT_MS: '100' }))
    const fn = client.createFunction({ id: 'sync-probe', triggers: [{ event: 'test/sync' }] }, async () => 'ok')
    const { serve } = await import('inngest/next')
    const handlers = serve({ client, functions: [fn], serveOrigin: 'http://127.0.0.1:3000' }) as unknown as {
      PUT: (req: NextRequest) => Promise<Response>
    }

    const res = await handlers.PUT(new NextRequest('http://127.0.0.1:3000/api/inngest', { method: 'PUT' }))

    expect(seen).toEqual(['POST /fn/register'])
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ modified: true })
  })
})
