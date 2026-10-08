/**
 * Background processing of bot updates.
 *
 * Telegram waits for the webhook answer and re-sends an update it did not
 * get a 2xx for; an assistant answer (model ↔ tools, voice, documents) takes
 * longer than that comfortably allows. On Vercel the route answers 200 at
 * once and keeps the function alive for the work with `waitUntil` from
 * `@vercel/functions`. Outside Vercel (next dev / start, tests) there is no
 * request context, so the work is simply awaited before answering — the old
 * synchronous behaviour.
 */
import { waitUntil } from '@vercel/functions'

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

/** Hand `work` to waitUntil when possible; otherwise await it. Never rejects. */
export async function deferOrAwait(work: Promise<unknown>): Promise<DeferMode> {
  const safe = work.then(() => undefined, () => undefined)
  if (hasWaitUntil()) {
    waitUntil(safe)
    return 'deferred'
  }
  await safe
  return 'awaited'
}
