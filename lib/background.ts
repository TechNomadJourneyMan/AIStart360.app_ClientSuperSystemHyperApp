/**
 * lib/background.ts — run work after the HTTP response without blocking it.
 *
 * On Vercel the function may be frozen as soon as the response is sent, so
 * un-awaited promises can be dropped. Vercel exposes a per-request context
 * with `waitUntil` under a well-known global symbol (the same mechanism
 * `@vercel/functions` uses); when it is present we register the promise there.
 * Locally (`next dev`, tests) the Node process keeps running, so the promise
 * simply completes on its own.
 *
 * On a persistent server (Railway, PERSISTENT_SERVER=1) the process outlives
 * every response, but it gets a SIGTERM on each redeploy: every promise is also
 * kept in a set of unfinished work, and `waitForBackgroundWork` lets the
 * shutdown handler wait for it (up to a deadline) before the process exits.
 *
 * Errors are caught and logged: background work must never crash the request.
 */

type RequestContext = { waitUntil?: (p: Promise<unknown>) => void }
type ContextStore = { get?: () => RequestContext | undefined }

// The set lives on globalThis: Next compiles instrumentation.ts (where the SIGTERM handler is
// registered) and the route handlers as separate module graphs, each with its own copy of this
// file. A module-level Set would be empty in the copy the shutdown handler sees.
const PENDING_KEY = Symbol.for('aistart360.background.pending')

function pendingSet(): Set<Promise<unknown>> {
  const g = globalThis as Record<symbol, Set<Promise<unknown>> | undefined>
  return (g[PENDING_KEY] ??= new Set<Promise<unknown>>())
}

/**
 * Register already-running work: in the set of unfinished work (until it settles, either way)
 * and, when there is a Vercel request context, in its `waitUntil`. Never throws.
 */
export function trackBackground(promise: Promise<unknown>): void {
  const pending = pendingSet()
  pending.add(promise)
  // Also marks a rejection as handled; the caller owns reporting errors.
  const forget = () => { pending.delete(promise) }
  promise.then(forget, forget)
  try {
    const store = (globalThis as Record<symbol, ContextStore | undefined>)[Symbol.for('@vercel/request-context')]
    store?.get?.()?.waitUntil?.(promise)
  } catch {
    // no request context — fine outside Vercel
  }
}

/** How many tracked promises have not settled yet. */
export function pendingBackgroundCount(): number {
  return pendingSet().size
}

/**
 * Wait until all tracked work has settled, or `timeoutMs` has passed. Work that starts while
 * waiting is waited for too. Never rejects: a failed promise counts as finished.
 */
export async function waitForBackgroundWork(timeoutMs: number): Promise<{ finished: boolean; pending: number }> {
  const pending = pendingSet()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, timeoutMs))
  })
  try {
    while (pending.size > 0) {
      const settled = Promise.allSettled([...pending]).then(() => 'settled' as const)
      if ((await Promise.race([settled, expired])) === 'timeout') break
    }
  } finally {
    clearTimeout(timer)
  }
  return { finished: pending.size === 0, pending: pending.size }
}

export function runInBackground(label: string, work: () => Promise<unknown>): Promise<void> {
  const promise = (async () => {
    try {
      await work()
    } catch (err) {
      console.error(`[background:${label}]`, err instanceof Error ? err.message : err)
    }
  })()
  trackBackground(promise)
  return promise
}
