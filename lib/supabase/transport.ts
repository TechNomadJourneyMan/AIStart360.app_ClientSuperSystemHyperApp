/**
 * lib/supabase/transport.ts — the fetch used for the portal's own Supabase gateway.
 *
 * The gateway is reached through the hosting platform's public edge, and that edge can answer a
 * request by itself: HTTP 404 «Application not found» with `x-railway-fallback: true`. The gateway
 * never sends that header and never saw the request, yet supabase-js hands the 404 to its caller
 * as a real answer — a lost session, an empty page, a 503 from a route. The wrapper sends such a
 * request again and is careful with everything else:
 *
 *   - only the origin of NEXT_PUBLIC_SUPABASE_URL is handled. Any other host, and any call whose
 *     first argument is a Request, reaches the base fetch with the caller's own arguments, once;
 *   - a request that may have been executed is never sent a second time (see `send`);
 *   - optionally the first attempt goes over the private network (SUPABASE_INTERNAL_URL), which
 *     does not pass the edge at all;
 *   - no attempt waits forever (R-014): each one has a timeout, the request as a whole a deadline.
 *     A private path that hangs without an error (no ECONNREFUSED, no reset — just silence) is
 *     given up after a short timeout, put on cooldown, and the request goes on over the public
 *     origin. The timers cover the time to the response headers only; reading the body is the
 *     caller's business. The caller's own signal is honoured as before.
 *
 * Edge-safe (Web APIs only): the Node server installs it over `globalThis.fetch`
 * (instrumentation.ts), middleware uses it through lib/supabase/transport-edge.ts.
 */

export interface TransportOptions {
  env?: { NEXT_PUBLIC_SUPABASE_URL?: string; SUPABASE_INTERNAL_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string }
  sleep?: (ms: number) => Promise<void>
  /** Default `console.warn`. */
  log?: (line: string) => void
  /** Default `Math.random`. */
  random?: () => number
  /** Default `Date.now`. */
  now?: () => number
  /** R-014. Default: the SUPABASE_* env variables below, else TRANSPORT_TIMEOUT_DEFAULTS. 0 = off. */
  timeouts?: Partial<TransportTimeouts>
}

export interface TransportTimeouts {
  /** One attempt on the public origin (and a POST/PATCH/… on the private path), to the headers. */
  attemptMs: number
  /** A GET/HEAD attempt on the private path: short, the public origin takes over after it. */
  internalAttemptMs: number
  /** The whole request: every attempt and pause together. */
  deadlineMs: number
  /** The one probe of the private path. */
  probeMs: number
}

/**
 * Why these values (R-014): the portal's Supabase requests answer in 52–143 ms at p99, and the
 * gateway gives PostgREST statements of the API roles 8 s (`authenticated` statement_timeout).
 *   - internalAttemptMs 4 s: ~30× the p99; a private path silent for that long is hung, and a GET
 *     can be sent again over the public origin;
 *   - attemptMs 15 s: above the 8 s statement timeout plus the trip, so a slow but healthy query
 *     is never cut;
 *   - deadlineMs 25 s: one full attempt plus a retry, under the project rule of ≤ 45 s per unit
 *     of work, so the route or job above it still has time to answer;
 *   - probeMs 3 s: the probe runs at boot; without a bound a silent private network kept it
 *     pending forever (harmless, but never resolved).
 * Each can be changed without a deploy of code: SUPABASE_FETCH_ATTEMPT_TIMEOUT_MS,
 * SUPABASE_INTERNAL_ATTEMPT_TIMEOUT_MS, SUPABASE_FETCH_DEADLINE_MS, SUPABASE_PROBE_TIMEOUT_MS
 * (0 turns that one off).
 */
export const TRANSPORT_TIMEOUT_DEFAULTS: Readonly<TransportTimeouts> = Object.freeze({
  attemptMs: 15_000,
  internalAttemptMs: 4_000,
  deadlineMs: 25_000,
  probeMs: 3_000,
})

export const MAX_RETRIES = 2
export const RETRY_DELAYS_MS = [150, 400] as const
export const INTERNAL_COOLDOWN_MS = 60_000

/**
 * `off` — no private path configured; `pending` — configured, not probed yet; `active` — the first
 * attempt of a request uses it; `disabled` — the probe failed (for good) or an attempt failed
 * (for INTERNAL_COOLDOWN_MS).
 */
export type InternalPathState = 'off' | 'pending' | 'active' | 'disabled'

export type SupabaseTransportFetch = typeof fetch & {
  internalState(): InternalPathState
  probe(): Promise<boolean>
}

const MARKER = Symbol.for('aistart360.supabaseTransport')
const PREFIX = '[supabase-transport]'
/** What a gateway or a proxy answers while the service behind it is away. */
const UNAVAILABLE = new Set([502, 503, 504])
/** Failures of the connection phase: the request never left this process. */
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])

/** A non-negative integer of ms from the environment, else `fallback`. */
function msFrom(raw: string | undefined, fallback: number): number {
  const value = raw?.trim() ? Number(raw) : Number.NaN
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function envTimeouts(): TransportTimeouts {
  const d = TRANSPORT_TIMEOUT_DEFAULTS
  // Member by member, like defaultEnv.
  return {
    attemptMs: msFrom(process.env.SUPABASE_FETCH_ATTEMPT_TIMEOUT_MS, d.attemptMs),
    internalAttemptMs: msFrom(process.env.SUPABASE_INTERNAL_ATTEMPT_TIMEOUT_MS, d.internalAttemptMs),
    deadlineMs: msFrom(process.env.SUPABASE_FETCH_DEADLINE_MS, d.deadlineMs),
    probeMs: msFrom(process.env.SUPABASE_PROBE_TIMEOUT_MS, d.probeMs),
  }
}

/** Errors made by the transport's own timers (not the caller's abort). */
const OWN_TIMEOUTS = new WeakSet<object>()

function ownTimeout(message: string): DOMException {
  const error = new DOMException(message, 'TimeoutError')
  OWN_TIMEOUTS.add(error)
  return error
}

function defaultEnv(): NonNullable<TransportOptions['env']> {
  // Member by member: Next inlines NEXT_PUBLIC_* into a bundle only where it is written out.
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
}

/** Origin of an http(s) URL, or null for anything else. */
function httpOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** A body that can be handed to fetch again. A stream is consumed by the first attempt. */
function isReplayable(body: unknown): boolean {
  return (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof FormData
  )
}

function isAbort(error: unknown, signal: AbortSignal | null | undefined): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name
  return name === 'AbortError' || name === 'TimeoutError' || signal?.aborted === true
}

/** `cause.code` of a failed fetch (ECONNREFUSED, UND_ERR_SOCKET, …) when there is one. */
function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause
  const code = (cause as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && code ? code : null
}

/** What a log line says about a thrown error: its code or its name, never its message. */
function failureLabel(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name
  return causeCode(error) ?? (typeof name === 'string' && name ? name : 'Error')
}

/** Releases the connection of a response nobody is going to read. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // already read or errored: nothing left to release
  }
}

export function createSupabaseTransportFetch(base: typeof fetch, opts: TransportOptions = {}): SupabaseTransportFetch {
  const env = opts.env ?? defaultEnv()
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const log = opts.log ?? ((line: string) => console.warn(line))
  const random = opts.random ?? (() => Math.random())
  const now = opts.now ?? (() => Date.now())
  const timeouts: TransportTimeouts = { ...envTimeouts(), ...opts.timeouts }

  const publicOrigin = httpOrigin(env.NEXT_PUBLIC_SUPABASE_URL)
  // Without a public origin nothing is handled, so there is nothing for the private path to carry.
  const internalOrigin = publicOrigin ? httpOrigin(env.SUPABASE_INTERNAL_URL) : null
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  let probed: 'no' | 'ok' | 'failed' = 'no'
  let probing: Promise<boolean> | null = null
  /** After a failed attempt the private path is left alone until this moment. */
  let internalBackAt = 0

  function internalState(): InternalPathState {
    if (!internalOrigin) return 'off'
    if (probed === 'no') return 'pending'
    if (probed === 'failed') return 'disabled'
    return now() < internalBackAt ? 'disabled' : 'active'
  }

  /**
   * One request decides whether the private path is used at all: off the platform's private
   * network (a build, a laptop, another host) the name does not resolve, and the path stays
   * disabled for the life of the wrapper. Runs once however often it is called; never rejects.
   */
  function probe(): Promise<boolean> {
    if (!internalOrigin) return Promise.resolve(false)
    probing ??= runProbe(internalOrigin)
    return probing
  }

  /**
   * One call of the base fetch with a timeout of `timeoutMs` (0 = none) to the response headers.
   * The caller's signal is linked to the attempt's own; a timeout rejects with an own TimeoutError.
   */
  async function attempt(target: string | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
    // A copy per attempt: a base that edits its init (the Edge sandbox's fetch replaces
    // `init.headers`) must not pass one attempt's edits on to the next, or to the caller.
    if (timeoutMs <= 0) return base(target, init && { ...init })
    const callerSignal = init?.signal ?? null
    const controller = new AbortController()
    const onCallerAbort = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) controller.abort(callerSignal.reason)
    // Kept after the headers: a caller that gives up while reading the body still cancels it.
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    let timedOut: DOMException | null = null
    const timer = setTimeout(() => {
      timedOut = ownTimeout(`attempt timed out after ${timeoutMs} ms`)
      controller.abort(timedOut)
    }, timeoutMs)
    try {
      return await base(target, { ...init, signal: controller.signal })
    } catch (error) {
      callerSignal?.removeEventListener('abort', onCallerAbort)
      if (timedOut && !callerSignal?.aborted) throw timedOut
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function runProbe(origin: string): Promise<boolean> {
    let outcome: string
    try {
      const response = await attempt(`${origin}/auth/v1/settings`, {
        method: 'GET',
        headers: anonKey ? { apikey: anonKey } : {},
      }, timeouts.probeMs)
      await discard(response)
      if (response.status === 200) {
        probed = 'ok'
        return true
      }
      outcome = String(response.status)
    } catch (error) {
      outcome = failureLabel(error)
    }
    probed = 'failed'
    log(`${PREFIX} internal probe failed (${outcome}), internal path disabled`)
    return false
  }

  /** The parsed URL when the call is ours to handle: a string or a URL on the public origin. */
  function ownUrl(input: unknown): URL | null {
    if (!publicOrigin) return null
    if (typeof input !== 'string' && !(input instanceof URL)) return null
    try {
      const url = new URL(input)
      return url.origin === publicOrigin ? url : null
    } catch {
      return null
    }
  }

  /** Pathname only: the query string carries row filters, the host and the headers carry keys. */
  async function pause(retry: number, method: string, pathname: string, reason: string): Promise<void> {
    log(`${PREFIX} retry ${retry}/${MAX_RETRIES} ${method} ${pathname} — ${reason}`)
    await sleep(RETRY_DELAYS_MS[retry - 1] * (1 + random() * 0.25))
  }

  /**
   * When a request is sent again:
   *   - the edge answered by itself (`x-railway-fallback: true`): the application never saw the
   *     request, so any method is safe;
   *   - 502 / 503 / 504 without that header: GET and HEAD only — the gateway may have executed
   *     anything else before a proxy gave up on it;
   *   - the base fetch threw: GET and HEAD always, other methods only when the connection was never
   *     made (NEVER_SENT). A reset after the request left is ambiguous: POST /auth/v1/token may
   *     already have rotated the refresh token, and a second send would present a spent one;
   *   - never after an abort, and never with a body that cannot be handed over twice;
   *   - an attempt that timed out (R-014) counts as an ambiguous failure: GET and HEAD only.
   * Only the first attempt may use the private path; a network failure or a timeout there moves
   * the request to the public origin without spending a retry. No attempt and no pause starts
   * past the request deadline.
   */
  async function send(input: string | URL, url: URL, init: RequestInit | undefined): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase()
    const safe = method === 'GET' || method === 'HEAD'
    const replayable = isReplayable(init?.body)
    let internal = internalState() === 'active'
    let retries = 0
    const deadlineAt = timeouts.deadlineMs > 0 ? Date.now() + timeouts.deadlineMs : Number.POSITIVE_INFINITY
    const left = () => deadlineAt - Date.now()
    /** The timeout of the next attempt: its own limit, never past the request deadline. */
    const attemptTimeout = (): number => {
      const own = internal && safe && timeouts.internalAttemptMs > 0
        ? (timeouts.attemptMs > 0 ? Math.min(timeouts.internalAttemptMs, timeouts.attemptMs) : timeouts.internalAttemptMs)
        : timeouts.attemptMs
      if (deadlineAt === Number.POSITIVE_INFINITY) return own
      const rest = Math.max(1, left())
      return own > 0 ? Math.min(own, rest) : rest
    }
    /** Is there time for a pause before retry n and an attempt after it? */
    const timeForRetry = (n: number) => left() > RETRY_DELAYS_MS[n - 1] * 1.25

    for (;;) {
      if (left() <= 0) throw ownTimeout(`request deadline of ${timeouts.deadlineMs} ms exceeded`)
      let response: Response
      const timeoutMs = attemptTimeout()
      try {
        response = await attempt(internal ? `${internalOrigin}${url.pathname}${url.search}` : input, init, timeoutMs)
      } catch (error) {
        const timedOut = OWN_TIMEOUTS.has(error as object)
        if (!timedOut && isAbort(error, init?.signal)) throw error
        const code = causeCode(error)
        const mayResend = timedOut
          ? replayable && safe
          : replayable && (safe || (code !== null && NEVER_SENT.has(code)))
        if (internal) {
          // An ambiguous network failure keeps the path (it may be the request, not the path);
          // a path that stayed silent for the whole attempt is hung and goes on cooldown.
          if (!mayResend && !timedOut) throw error
          internal = false
          if (internalState() === 'active') {
            internalBackAt = now() + INTERNAL_COOLDOWN_MS
            log(timedOut
              ? `${PREFIX} internal path timed out (${timeoutMs} ms), using public for ${INTERNAL_COOLDOWN_MS / 1000} s`
              : `${PREFIX} internal path failed (${failureLabel(error)}), using public for ${INTERNAL_COOLDOWN_MS / 1000} s`)
          }
          if (!mayResend || left() <= 0) throw error
          continue
        }
        if (!mayResend || retries >= MAX_RETRIES || !timeForRetry(retries + 1)) throw error
        retries += 1
        await pause(retries, method, url.pathname, timedOut ? `timeout ${timeoutMs} ms` : `network ${failureLabel(error)}`)
        continue
      }

      const edgeAnswered = response.headers.get('x-railway-fallback') === 'true'
      const sendAgain = edgeAnswered || (safe && UNAVAILABLE.has(response.status))
      if (!sendAgain || !replayable || retries >= MAX_RETRIES || !timeForRetry(retries + 1)) return response
      await discard(response)
      internal = false
      retries += 1
      await pause(retries, method, url.pathname, `${edgeAnswered ? 'edge fallback' : 'status'} ${response.status}`)
    }
  }

  const transport = ((...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = ownUrl(args[0])
    return url ? send(args[0] as string | URL, url, args[1]) : base(...args)
  }) as typeof fetch

  return Object.assign(transport, { internalState, probe })
}

/**
 * Puts the wrapper over `globalThis.fetch`, once. Some 270 call sites build their Supabase client
 * inline, so the Node server wraps the one fetch they all end in rather than handing a fetch to
 * each client; Next patches `globalThis.fetch` later, per request, and wraps whatever it finds.
 * Returns false when the wrapper is already there.
 */
export function installSupabaseTransport(opts: TransportOptions = {}): boolean {
  const current = globalThis.fetch
  if (typeof current !== 'function' || (current as unknown as Record<symbol, unknown>)[MARKER] === true) return false

  const wrapper = createSupabaseTransportFetch(current, opts)
  // What a framework keeps on the function (Next's `__nextPatched` and friends) must survive.
  for (const key of Reflect.ownKeys(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor?.enumerable && !(key in wrapper)) Object.defineProperty(wrapper, key, descriptor)
  }
  Object.defineProperty(wrapper, MARKER, { value: true })
  globalThis.fetch = wrapper
  void wrapper.probe()
  return true
}
