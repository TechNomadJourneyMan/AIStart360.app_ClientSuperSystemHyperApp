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
 * Errors are caught and logged: background work must never crash the request.
 */

type RequestContext = { waitUntil?: (p: Promise<unknown>) => void }
type ContextStore = { get?: () => RequestContext | undefined }

export function runInBackground(label: string, work: () => Promise<unknown>): Promise<void> {
  const promise = (async () => {
    try {
      await work()
    } catch (err) {
      console.error(`[background:${label}]`, err instanceof Error ? err.message : err)
    }
  })()
  try {
    const store = (globalThis as Record<symbol, ContextStore | undefined>)[Symbol.for('@vercel/request-context')]
    store?.get?.()?.waitUntil?.(promise)
  } catch {
    // no request context — fine outside Vercel
  }
  return promise
}
