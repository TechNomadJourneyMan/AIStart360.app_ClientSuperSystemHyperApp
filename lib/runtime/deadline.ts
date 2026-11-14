/**
 * lib/runtime/deadline.ts — time budgets for work that has no platform limit (R-015, R-016).
 *
 * On Vercel `export const maxDuration` killed a function that ran too long. On Railway the portal
 * is `next start`, which ignores maxDuration: a request has no time limit at all, and neither does
 * a chain of model calls inside it. Node's own server timeouts do not help: `requestTimeout`
 * (300 s) and `headersTimeout` (60 s) bound how long the CLIENT may take to send its request, not
 * how long the handler may take to answer, and `next start` exposes only `--keepAliveTimeout`.
 *
 * What this module gives instead:
 *   - `envMs(name, fallback)` — a millisecond setting from the environment, with a sane fallback;
 *   - `withDeadline(handler, { label, ms })` — a route handler that answers 504 once `ms` passed
 *     without a response, and aborts the deadline's AbortSignal so the work that honours it stops.
 *     The timer covers the time to the Response object only: a streamed body (SSE, the assistant)
 *     is never cut by it;
 *   - an ambient deadline (AsyncLocalStorage): code below the handler — the AI failover in
 *     particular — reads `deadlineRemainingMs()` and never plans past the request's own budget.
 *
 * ROUTE_DEADLINE_DISABLED=1 turns the route wrapper off (rollback without a deploy of code).
 * Edge-safe: AsyncLocalStorage is taken from globalThis (Next puts it there in both runtimes);
 * without it the ambient part is simply absent.
 */

export interface Deadline {
  /** Absolute time (ms since epoch) at which the budget is spent. */
  readonly at: number
  /** Aborted (reason: DeadlineExceededError) when the budget is spent. */
  readonly signal: AbortSignal
  readonly label: string
}

export class DeadlineExceededError extends Error {
  readonly code = 'DEADLINE_EXCEEDED'
  constructor(readonly label: string, readonly ms: number) {
    super(`deadline ${label} exceeded after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/** A positive integer number of ms from the environment, else `fallback`. 0 is allowed (= off) only when `allowZero`. */
export function envMs(name: string, fallback: number, opts: { allowZero?: boolean; env?: Record<string, string | undefined> } = {}): number {
  const raw = (opts.env ?? process.env)[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallback
  if (value === 0) return opts.allowZero ? 0 : fallback
  return Math.floor(value)
}

interface Store {
  run<R>(store: Deadline, fn: () => R): R
  getStore(): Deadline | undefined
}

let storage: Store | null | undefined

function als(): Store | null {
  if (storage !== undefined) return storage
  const Ctor = (globalThis as { AsyncLocalStorage?: new () => Store }).AsyncLocalStorage
  storage = typeof Ctor === 'function' ? new Ctor() : null
  return storage
}

/** The deadline of the current request / job, when one is set. */
export function currentDeadline(): Deadline | null {
  return als()?.getStore() ?? null
}

/** Milliseconds left of the ambient deadline (never negative), or null when there is none. */
export function deadlineRemainingMs(now: number = Date.now()): number | null {
  const d = currentDeadline()
  return d ? Math.max(0, d.at - now) : null
}

/**
 * Runs `fn` under a deadline of `ms`. A deadline already in force is never extended: the nearer of
 * the two wins. The signal is aborted when the time is up; `fn` is not interrupted otherwise.
 */
export async function runWithDeadline<R>(
  label: string,
  ms: number,
  fn: (deadline: Deadline) => Promise<R>,
  now: () => number = Date.now,
): Promise<R> {
  const outer = currentDeadline()
  const at = Math.min(now() + ms, outer?.at ?? Number.POSITIVE_INFINITY)
  const controller = new AbortController()
  const deadline: Deadline = { at, signal: controller.signal, label }
  const timer = setTimeout(() => controller.abort(new DeadlineExceededError(label, ms)), Math.max(0, at - now()))
  const onOuterAbort = () => controller.abort(outer?.signal.reason)
  outer?.signal.addEventListener('abort', onOuterAbort, { once: true })
  try {
    const store = als()
    return store ? await store.run(deadline, () => fn(deadline)) : await fn(deadline)
  } finally {
    clearTimeout(timer)
    outer?.signal.removeEventListener('abort', onOuterAbort)
  }
}

export interface WithDeadlineOptions {
  /** Short route name for the log and the env override. */
  label: string
  /** Budget until the Response object is returned. */
  ms: number
  /** Default console.warn. */
  log?: (line: string) => void
}

/** The answer of a route whose budget is spent; the UI shows `error` as is. */
export function deadlineResponse(label: string): Response {
  return new Response(
    JSON.stringify({ ok: false, code: 'DEADLINE_EXCEEDED', error: 'Сервер не успел ответить. Попробуйте ещё раз через минуту.' }),
    { status: 504, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-deadline': label } },
  )
}

/**
 * A route handler with a time budget (R-015). When the handler has not produced its Response in
 * `ms`, the client gets 504 at once and the deadline signal is aborted; the handler keeps running
 * until it notices (its later Response is dropped). Its errors after that are logged, not thrown.
 */
// The returned function has the shape of a Next route handler, `(req, ctx?)`: a handler that takes
// only the request gives a wrapper whose context is optional (the way Next and the tests call
// static routes); a handler that needs `{ params }` keeps it required.
export function withDeadline<Req extends Request = Request>(
  handler: (req: Req) => Promise<Response> | Response,
  opts: WithDeadlineOptions,
): (req: Req, ctx?: unknown) => Promise<Response>
export function withDeadline<C, Req extends Request = Request>(
  handler: (req: Req, ctx: C) => Promise<Response> | Response,
  opts: WithDeadlineOptions,
): (req: Req, ctx: C) => Promise<Response>
export function withDeadline<C, Req extends Request = Request>(
  handler: (req: Req, ctx: C) => Promise<Response> | Response,
  opts: WithDeadlineOptions,
): (req: Req, ctx: C) => Promise<Response> {
  const log = opts.log ?? ((line: string) => console.warn(line))
  return async (req: Req, ctx: C) => {
    if (process.env.ROUTE_DEADLINE_DISABLED === '1') return handler(req, ctx)
    const ms = envMs(`ROUTE_DEADLINE_MS_${opts.label.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, opts.ms)
    const started = Date.now()
    return runWithDeadline(opts.label, ms, async (deadline) => {
      const work = Promise.resolve().then(() => handler(req, ctx))
      const expired = new Promise<'expired'>((resolve) => {
        if (deadline.signal.aborted) resolve('expired')
        else deadline.signal.addEventListener('abort', () => resolve('expired'), { once: true })
      })
      const winner = await Promise.race([work, expired])
      if (winner !== 'expired') return winner
      log(JSON.stringify({ event: 'route_deadline_exceeded', route: opts.label, ms, elapsed_ms: Date.now() - started }))
      work.catch((err: unknown) => {
        const name = (err as { name?: unknown } | null)?.name
        log(JSON.stringify({ event: 'route_deadline_late_error', route: opts.label, error: typeof name === 'string' ? name : 'Error' }))
      })
      return deadlineResponse(opts.label)
    })
  }
}
