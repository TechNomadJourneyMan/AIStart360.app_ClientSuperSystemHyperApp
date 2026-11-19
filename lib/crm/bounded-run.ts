/**
 * lib/crm/bounded-run.ts — run per-item background work within the platform's rule for background
 * jobs: at most `concurrency` (≤ 2) at a time, and no item STARTED with less than `minStartMs`
 * left before `deadlineAt`. Items not started are counted as deferred — never silently dropped.
 * An item already running is not interrupted by runBounded itself: each provider call inside it
 * goes through beforeDeadline, so a send that never answers cannot hold the run past its deadline.
 */
export interface BoundedRunOptions {
  concurrency: number
  deadlineAt: number
  minStartMs: number
  now?: () => number
}

export async function runBounded<T>(
  items: readonly T[],
  opts: BoundedRunOptions,
  work: (item: T) => Promise<void>,
): Promise<{ started: number; deferred: number }> {
  const now = opts.now ?? Date.now
  let next = 0
  let started = 0
  let stopped = false
  const worker = async () => {
    while (!stopped && next < items.length) {
      if (opts.deadlineAt - now() < opts.minStartMs) {
        stopped = true
        return
      }
      const item = items[next++]
      started++
      try {
        await work(item)
      } catch (e) {
        console.warn('[bounded-run] item failed', e instanceof Error ? e.message : e)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(0, Math.min(opts.concurrency, items.length)) }, worker))
  return { started, deferred: items.length - started }
}

/**
 * Run one provider call within what is left of the run: `{ ok: true, value }` when it answers
 * before `deadlineAt`, `{ ok: false }` when the deadline comes first — and it is not started at all
 * when nothing is left. The call is abandoned, not cancelled (an SDK without an AbortSignal, like
 * Resend's, cannot be): its late answer is ignored. A rejection propagates.
 */
export async function beforeDeadline<T>(
  start: () => Promise<T>,
  deadlineAt: number,
  now: () => number = Date.now,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const left = deadlineAt - now()
  if (left <= 0) return { ok: false }
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      start().then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), left)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** A stable per-day order for ties: the same owners are not always the last ones of a long run. */
export function dayRotation(day: string, id: string): number {
  let h = 2166136261
  for (const ch of `${day}:${id}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
