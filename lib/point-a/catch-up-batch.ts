/**
 * lib/point-a/catch-up-batch.ts — the paid AI catch-up for MANY clients at once
 * (R2-C verify: the bulk «Сменить тариф → Pro», lib/admin/bulk-users.ts).
 *
 * catchUpPaidAi (lib/point-a/diagnostic-row.ts) fires the paid AI of one client
 * and returns at once; called for 200 clients it would start ~400 AI requests
 * together. Here the clients go through a pool of at most `concurrency` (2 —
 * the rule of the project for background work after the 504 incident of
 * 2026-10-15), and a client's slot is held until ITS AI calls have settled
 * (each call keeps its own timeout, fanOutTimeoutMs) — and its AI hypotheses
 * catch-up (R3-VERIFY N1: they used to run detached, all clients at once). The caller runs the batch
 * in the background (runInBackground): the HTTP answer never waits for it.
 */
import { trackBackground } from '@/lib/background'
import { catchUpPaidAi, fireAiFanOut, type FanOutOpts } from './diagnostic-row'

export const CATCH_UP_CONCURRENCY = 2

/** One client's catch-up, resolved only when its AI calls have settled. Never throws. */
export async function catchUpPaidAiAwaited(
  userId: string,
  deps: { catchUp?: typeof catchUpPaidAi; fanOut?: (o: FanOutOpts, d: { track: (w: Promise<unknown>) => void }) => void; hasKey?: () => boolean } = {},
): Promise<void> {
  const hasKey = deps.hasKey ?? (() => Boolean(process.env.OPENROUTER_API_KEY))
  if (!hasKey()) return
  const works: Promise<unknown>[] = []
  const track = (w: Promise<unknown>) => {
    works.push(w)
    try { trackBackground(w) } catch { /* untracked */ }
  }
  try {
    // The analysis fan-out AND the hypotheses catch-up (R3-VERIFY N1) are this client's work: the slot waits for both.
    await (deps.catchUp ?? catchUpPaidAi)(userId, { fire: (o) => (deps.fanOut ?? fireAiFanOut)(o, { track }), track })
  } catch (err) {
    console.error('[point-a] paid AI catch-up failed:', err instanceof Error ? err.message : err)
  }
  await Promise.allSettled(works)
}

/** All clients, at most `concurrency` at a time; one failure never stops the others. */
export async function catchUpPaidAiBatch(
  userIds: readonly string[],
  opts: { concurrency?: number; run?: (userId: string) => Promise<void> } = {},
): Promise<void> {
  const ids = Array.from(new Set(userIds))
  const limit = Math.max(1, Math.min(opts.concurrency ?? CATCH_UP_CONCURRENCY, CATCH_UP_CONCURRENCY))
  const run = opts.run ?? ((id: string) => catchUpPaidAiAwaited(id))
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]
      try {
        await run(id)
      } catch (err) {
        console.error('[point-a] paid AI catch-up failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker))
}
