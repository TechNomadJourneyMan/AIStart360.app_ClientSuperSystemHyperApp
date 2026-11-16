import { Inngest } from 'inngest'
import { inngestTarget } from '@/lib/inngest-target'
import { currentDeadline, envMs, runWithDeadline } from '@/lib/runtime/deadline'

export { inngestEnabled, inngestTarget, type InngestTarget } from '@/lib/inngest-target'

/**
 * lib/inngest.ts — the Inngest client of the portal.
 *
 * Two places the client can talk to:
 *   • our own Inngest server on Railway (self-hosted, `inngest start`, service `inngest`) —
 *     when INNGEST_SELF_HOSTED_URL is set, e.g. http://inngest.railway.internal:8288. Its keys
 *     are INNGEST_SELF_EVENT_KEY and INNGEST_SELF_SIGNING_KEY (hex, the same values the server is
 *     started with). The client never falls back to the cloud while this is set: the base URL,
 *     the keys and «not dev mode» are all explicit;
 *   • Inngest Cloud (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY) — what ran before 2026-11-15, when
 *     the cloud plan ran out and Inngest stopped calling the portal.
 *
 * Switching back is unsetting INNGEST_SELF_HOSTED_URL: the cloud variables are left in place.
 *
 * Time limits (N4A-1). The SDK sends an event with a bare `fetch` (no signal) and tries up to 5
 * times (inngest/components/Inngest.js `_send`, `retryWithBackoff`). `inngest.send` is awaited on
 * the path of webhooks (Meta, WhatsApp, Telegram inbox), of «Сообщения» and of the Point A queue:
 * an Inngest server that accepts the connection and never answers held each of those requests —
 * its socket, memory and Prisma connection — without end, while the provider re-delivered. So:
 *   • every request of the client has a timeout: an event send (`POST …/e/<key>`) 6 s per attempt
 *     (INNGEST_FETCH_TIMEOUT_MS); anything else — the sync's register call (PUT /api/inngest),
 *     the checkpoints and step reads the SDK makes while a function runs — 30 s
 *     (INNGEST_API_TIMEOUT_MS): larger bodies, still bounded. The incoming calls themselves
 *     (Inngest → POST /api/inngest) are answered by the route and never go through this fetch;
 *   • one `inngest.send`, all its attempts together, ends within 15 s (INNGEST_SEND_TIMEOUT_MS) —
 *     or sooner, when the request it runs in has a nearer deadline (lib/runtime/deadline.ts):
 *     the attempts still in flight are aborted, the caller gets an error and handles it as it
 *     handles any failed send (a webhook answers 500 and the provider delivers again).
 * `step.sendEvent` inside a function is bounded per attempt only; the function has its own timeouts.
 */
function clientOptions(env: NodeJS.ProcessEnv = process.env): ConstructorParameters<typeof Inngest>[0] {
  const target = inngestTarget(env)
  if (!target.selfHostedUrl) return { id: 'aistart360' }
  return {
    id: 'aistart360',
    baseUrl: target.selfHostedUrl,
    isDev: false,
    ...(target.eventKey ? { eventKey: target.eventKey } : {}),
    ...(target.signingKey ? { signingKey: target.signingKey } : {}),
  }
}

/** For tests: the options the client is built with under `env`. */
export const __inngestClientOptions = clientOptions

/** One attempt of an event send. */
export const INNGEST_EVENT_ATTEMPT_MS = 6_000
/** Any other request to the Inngest server (register, checkpoints, run steps). */
export const INNGEST_API_REQUEST_MS = 30_000
/** All attempts of one `inngest.send` together. */
export const INNGEST_SEND_TOTAL_MS = 15_000

/**
 * Raised by `inngest.send` when its budget is spent; callers treat it as any failed send. `ms` is
 * the budget the send really had (RA-4): its own 15 s, or what was left of the request's deadline
 * (`by: 'request'`) — never the configured value when the request cut it shorter.
 */
export class InngestSendTimeoutError extends Error {
  readonly code = 'INNGEST_SEND_TIMEOUT'
  constructor(readonly ms: number, readonly by: 'send' | 'request' = 'send') {
    super(`inngest send gave no answer within ${ms} ms (${by === 'request' ? 'the deadline of the request it ran in' : 'its own budget'})`)
    this.name = 'InngestSendTimeoutError'
  }
}

/** The event-send endpoint of the SDK: `POST <eventBaseUrl>/e/<event key>`. */
function isEventSend(url: string, method: string): boolean {
  if (method.toUpperCase() !== 'POST') return false
  try {
    return /\/e\/[^/]+$/.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** A signal aborted as soon as any of `signals` is (AbortSignal.any is Node ≥ 20.3; this is not). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0]
  const controller = new AbortController()
  const listeners: Array<[AbortSignal, () => void]> = []
  const detach = () => { for (const [sig, fn] of listeners) sig.removeEventListener('abort', fn) }
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason)
      detach()
      break
    }
    const fn = () => {
      if (!controller.signal.aborted) controller.abort(s.reason)
      detach()
    }
    listeners.push([s, fn])
    s.addEventListener('abort', fn, { once: true })
  }
  return controller.signal
}

/**
 * The `fetch` the client is given: a timeout on every request, the caller's own signal kept, and
 * the deadline of the request it runs in (when there is one) honoured as well.
 */
export function boundedInngestFetch(base?: typeof fetch, env: NodeJS.ProcessEnv = process.env): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET')
    const ms = isEventSend(url, method)
      ? envMs('INNGEST_FETCH_TIMEOUT_MS', INNGEST_EVENT_ATTEMPT_MS, { env })
      : envMs('INNGEST_API_TIMEOUT_MS', INNGEST_API_REQUEST_MS, { env })
    const signals = [AbortSignal.timeout(ms)]
    if (init?.signal) signals.push(init.signal)
    const ambient = currentDeadline()?.signal
    if (ambient) signals.push(ambient)
    const signal = anySignal(signals)
    try {
      // Read at call time: a test (or a polyfill) may replace the global after this module loaded.
      return await (base ?? globalThis.fetch)(input, { ...init, signal })
    } catch (err) {
      // RA-4: cut by our own limit (not the caller's signal). The SDK logs every error of a custom
      // fetch except «fetch failed …» at error level as a «misconfiguration», with a stack — once per
      // attempt, up to 5 per send. Said as the plain network failure it is: the SDK stays quiet and
      // the caller logs its one line.
      if (signal.aborted && !init?.signal?.aborted) {
        const reason = (signal.reason as { name?: unknown } | undefined)?.name
        throw new TypeError(`fetch failed: no answer from Inngest within the time limit (${typeof reason === 'string' ? reason : 'aborted'})`, { cause: signal.reason })
      }
      throw err
    }
  }
}

type Client = Inngest<ConstructorParameters<typeof Inngest>[0]>

/** `client.send` with a budget for all its attempts together (see the header). */
function boundSend(client: Client, env: NodeJS.ProcessEnv): Client {
  const unbounded = client.send.bind(client)
  const bounded = (...args: Parameters<typeof unbounded>) => {
    const ms = envMs('INNGEST_SEND_TIMEOUT_MS', INNGEST_SEND_TOTAL_MS, { env })
    const started = Date.now()
    // Under its own deadline: the fetch above sees it (ambient) and aborts the attempt in flight,
    // and every later attempt fails at once instead of waiting out its own timeout.
    return runWithDeadline('inngest-send', ms, (deadline) => new Promise<Awaited<ReturnType<typeof unbounded>>>((resolve, reject) => {
      // The budget it really had: a nearer deadline of the request wins (runWithDeadline).
      const budget = Math.min(ms, Math.max(0, deadline.at - started))
      const expired = () => reject(new InngestSendTimeoutError(budget, budget < ms ? 'request' : 'send'))
      if (deadline.signal.aborted) return expired()
      deadline.signal.addEventListener('abort', expired, { once: true })
      unbounded(...args).then(resolve, reject).finally(() => deadline.signal.removeEventListener('abort', expired))
    }))
  }
  client.send = bounded as typeof client.send
  return client
}

/** The client with the time limits above; `env` for tests. */
export function createInngestClient(env: NodeJS.ProcessEnv = process.env, base?: typeof fetch): Client {
  return boundSend(new Inngest({ ...clientOptions(env), fetch: boundedInngestFetch(base, env) }), env)
}

export const inngest = createInngestClient()
