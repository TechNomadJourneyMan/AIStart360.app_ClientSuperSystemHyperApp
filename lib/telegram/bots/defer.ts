/**
 * Background processing of bot updates.
 *
 * Telegram waits for the webhook answer and re-sends an update it did not
 * get a 2xx for; an assistant answer (model ↔ tools, voice, documents) takes
 * longer than that comfortably allows. On Vercel the route answers 200 at
 * once and keeps the function alive for the work with `waitUntil` from
 * `@vercel/functions`. On a persistent server (PERSISTENT_SERVER=1, Railway)
 * the route also answers at once: the process stays alive, and the work is
 * tracked so a SIGTERM can wait for it. Anywhere else (next dev, tests) there
 * is no request context, so the work is simply awaited before answering — the
 * old synchronous behaviour.
 */
import { waitUntil } from '@vercel/functions'
import { trackBackground } from '@/lib/background'
import { isPersistentServer } from '@/lib/runtime/platform'

type ContextStore = { get?: () => { waitUntil?: unknown } | undefined }

/** Is there a Vercel request context that can keep the function alive? */
export function hasWaitUntil(): boolean {
  try {
    const store = (globalThis as Record<symbol, ContextStore | undefined>)[Symbol.for('@vercel/request-context')]
    return typeof store?.get?.()?.waitUntil === 'function'
  } catch {
    return false
  }
}

export type DeferMode = 'deferred' | 'awaited'

/** Hand `work` to waitUntil (Vercel) or the background set (persistent server); otherwise await it. Never rejects. */
export async function deferOrAwait(work: Promise<unknown>): Promise<DeferMode> {
  const safe = work.then(() => undefined, () => undefined)
  if (hasWaitUntil()) {
    waitUntil(safe)
    return 'deferred'
  }
  if (isPersistentServer()) {
    trackBackground(safe)
    return 'deferred'
  }
  await safe
  return 'awaited'
}
