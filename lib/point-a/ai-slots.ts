/**
 * lib/point-a/ai-slots.ts — how many Point A AI jobs one process runs at a time (N4A-12, R4-A2).
 *
 * After a recalculation two kinds of model work start in the background of the process: the paid
 * AI analysis (fireAiFanOut → /api/v1/diagnostics/ai-analyze, up to 150 s) and the AI hypotheses of
 * the blocks without data (one model call per block, in a row). Nothing bounded them together: a
 * wave of snapshots — the nightly pass after a deploy that changed the Point A config version (it is
 * part of the inputs hash), or a bulk «→ Pro» — started one of each per company at once, each with
 * its model calls and its database reads. The project rule is at most two pieces of background work
 * at a time (the 504 of 2026-10-15); the agent runs have theirs (lib/agents/run-slots.ts), these
 * share one more set of slots:
 *   - POINT_A_AI_MAX_CONCURRENCY slots (default 2) for the analysis and the hypotheses together;
 *   - a job that finds none waits; at most POINT_A_AI_MAX_WAITING (default 50) wait, none longer than
 *     POINT_A_AI_SLOT_WAIT_MS (default 10 min, so a waiting analysis is never older than the 15 min
 *     after which the stale sweep marks it failed, lib/point-a/ai-claim.ts);
 *   - past that the analysis is not run: it is marked failed («Повторить» is offered). The AI
 *     hypotheses nobody waits for are never dropped (RA-2): they wait as long as it takes
 *     (acquirePatiently) — a wave delays them, it does not lose them;
 *   - the minute drain of the Point A queue takes no new rows while POINT_A_DRAIN_MAX_AI_WAITING
 *     (default 2) jobs already wait for a slot (RA-3, lib/point-a/recalc-queue.ts): a wave stays in
 *     the queue instead of overflowing the slots. The AI budget (assertAiBudget) stays the last guard.
 * On globalThis: Next bundles a module once per route, and the limit is per process.
 */
import { createSemaphore, type Release, type Semaphore } from '@/lib/agents/run-slots'

const KEY = Symbol.for('aistart360.pointA.aiSlots')

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/** The process-wide slots of Point A AI jobs (created on first use from the environment). */
export function pointAAiSlots(): Semaphore {
  const store = globalThis as Record<symbol, Semaphore | undefined>
  store[KEY] ??= createSemaphore({
    limit: intFromEnv('POINT_A_AI_MAX_CONCURRENCY', 2),
    maxWaiting: intFromEnv('POINT_A_AI_MAX_WAITING', 50),
    maxWaitMs: intFromEnv('POINT_A_AI_SLOT_WAIT_MS', 10 * 60_000),
  })
  return store[KEY]!
}

/**
 * A slot for work nobody waits for (the AI hypotheses, RA-2): when the queue of waiters is full or a
 * wait times out, it tries again after POINT_A_AI_SLOT_RETRY_MS (default 5 s) — until it has one.
 * Only a restart of the process loses it (as any background work).
 */
export async function acquirePatiently(slots: Semaphore = pointAAiSlots()): Promise<Release> {
  for (;;) {
    const release = await slots.acquire()
    if (release) return release
    await new Promise((resolve) => setTimeout(resolve, intFromEnv('POINT_A_AI_SLOT_RETRY_MS', 5_000)))
  }
}

/**
 * RA-3: so many Point A AI jobs already wait for a slot that the minute drain should not start more
 * (POINT_A_DRAIN_MAX_AI_WAITING, default 2). The rows stay in the queue for the next minute.
 */
export function pointAAiBacklogged(slots: Semaphore = pointAAiSlots()): boolean {
  return slots.waiting() >= intFromEnv('POINT_A_DRAIN_MAX_AI_WAITING', 2)
}

/** Tests only: forget the slots so the next call reads the environment again. */
export function resetPointAAiSlotsForTests(): void {
  delete (globalThis as Record<symbol, unknown>)[KEY]
}
