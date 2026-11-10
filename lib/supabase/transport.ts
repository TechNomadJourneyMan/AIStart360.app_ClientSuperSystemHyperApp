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
 *     does not pass the edge at all.
 *
 * Edge-safe (Web APIs only): the same module serves the Node server and middleware.
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
}

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

  async function runProbe(origin: string): Promise<boolean> {
    let outcome: string
    try {
      const response = await base(`${origin}/auth/v1/settings`, {
        method: 'GET',
        headers: anonKey ? { apikey: anonKey } : {},
      })
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
   *   - never after an abort, and never with a body that cannot be handed over twice.
   * Only the first attempt may use the private path; a network failure there moves the request to
   * the public origin without spending a retry.
   */
  async function send(input: string | URL, url: URL, init: RequestInit | undefined): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase()
    const safe = method === 'GET' || method === 'HEAD'
    const replayable = isReplayable(init?.body)
    let internal = internalState() === 'active'
    let retries = 0

    for (;;) {
      let response: Response
      try {
        response = await base(
          internal ? `${internalOrigin}${url.pathname}${url.search}` : input,
          // A copy per attempt: a base that edits its init (the Edge sandbox's fetch replaces
          // `init.headers`) must not pass one attempt's edits on to the next, or to the caller.
          init && { ...init },
        )
      } catch (error) {
        if (isAbort(error, init?.signal)) throw error
        const code = causeCode(error)
        const mayResend = replayable && (safe || (code !== null && NEVER_SENT.has(code)))
        if (internal) {
          if (!mayResend) throw error
          internal = false
          if (internalState() === 'active') {
            internalBackAt = now() + INTERNAL_COOLDOWN_MS
            log(`${PREFIX} internal path failed (${failureLabel(error)}), using public for ${INTERNAL_COOLDOWN_MS / 1000} s`)
          }
          continue
        }
        if (!mayResend || retries >= MAX_RETRIES) throw error
        retries += 1
        await pause(retries, method, url.pathname, `network ${failureLabel(error)}`)
        continue
      }

      const edgeAnswered = response.headers.get('x-railway-fallback') === 'true'
      const sendAgain = edgeAnswered || (safe && UNAVAILABLE.has(response.status))
      if (!sendAgain || !replayable || retries >= MAX_RETRIES) return response
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
