/**
 * lib/point-a/ai-slots.ts — how many Point A AI jobs one process runs at a time (N4A-12, R4-A2).
 *
 * After a recalculation two kinds of model work start in the background of the process: the paid
 * AI analysis (fireAiFanOut → /api/v1/diagnostics/ai-analyze, up to 150 s) and the AI hypotheses of
 * the blocks without data (one model call per block, in a row). Nothing bounded them together: a
 * wave of snapshots — the nightly pass after a deploy that changed the Point A config version (it is
 * part of the inputs hash), a template edit, a bulk «→ Pro» — started one of each per company at
 * once, each with its model calls and its database reads. The project rule is at most two pieces of
 * background work at a time (the 504 of 2026-10-15); the agent runs have theirs
 * (lib/agents/run-slots.ts), these share one more set of slots:
 *   - POINT_A_AI_MAX_CONCURRENCY slots (default 2) for the analysis and the hypotheses together;
 *   - the analysis — a client sees «ИИ анализирует…» and waits for it — goes first (NV-1): it never
 *     queues behind a hypothesis, and the hypotheses never hold more than `limit − 1` slots, so with
 *     two or more slots one is always left for an analysis. A wave of hypotheses delays only other
 *     hypotheses;
 *   - an analysis that finds no slot waits; at most POINT_A_AI_MAX_WAITING (default 50) analyses
 *     wait, none longer than POINT_A_AI_SLOT_WAIT_MS (default 10 min, so a waiting analysis is never
 *     older than the 15 min after which the stale sweep marks it failed, lib/point-a/ai-claim.ts);
 *     past that it is marked failed («Повторить» is offered);
 *   - the hypotheses nobody waits for are never dropped (RA-2): they wait as long as it takes, in
 *     their own queue (acquirePatiently). Only a restart of the process loses one, as any background work;
 *   - the minute drain of the Point A queue takes no new rows while POINT_A_DRAIN_MAX_AI_WAITING
 *     (default 2) jobs already wait for a slot (RA-3, lib/point-a/recalc-queue.ts): a wave stays in
 *     the queue instead of piling up here. The AI budget (assertAiBudget) stays the last guard.
 * On globalThis: Next bundles a module once per route, and the limit is per process.
 */
import type { Release, Semaphore } from '@/lib/agents/run-slots'

const KEY = Symbol.for('aistart360.pointA.aiSlots')

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/**
 * The Point A AI slots. As a Semaphore (tryAcquire / acquire) they serve the analysis, which goes
 * first; `acquireBackground` serves the hypotheses, after every waiting analysis and never dropped.
 * `waiting()` counts both queues, `active()` both kinds of running jobs.
 */
export interface PointAAiSlots extends Semaphore {
  /** A slot for work nobody waits for: behind every analysis, at most `backgroundLimit` at once, never refused. */
  acquireBackground(): Promise<Release>
  backgroundActive(): number
  readonly backgroundLimit: number
}

export interface PointAAiSlotsOptions {
  limit: number
  /** Analyses that may wait; one more is refused at once (null). */
  maxWaiting: number
  /** How long an analysis waits; then it is refused (null). */
  maxWaitMs: number
}

export function createPointAAiSlots(opts: PointAAiSlotsOptions): PointAAiSlots {
  const limit = Math.max(1, Math.floor(opts.limit))
  // With two slots or more one is always left for an analysis; with one there is nothing to leave.
  const backgroundLimit = Math.max(1, limit - 1)
  let active = 0
  let backgroundActive = 0
  const analyses: Array<(release: Release | null) => void> = []
  const background: Array<(release: Release) => void> = []

  function makeRelease(kind: 'analysis' | 'background'): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      if (kind === 'background') backgroundActive -= 1
      dispatch()
    }
  }

  const backgroundMayRun = () => active < limit && backgroundActive < backgroundLimit && analyses.length === 0

  /** Free slots go to the waiting analyses first, then to the waiting hypotheses. */
  function dispatch(): void {
    while (active < limit && analyses.length > 0) {
      const next = analyses.shift()!
      active += 1
      next(makeRelease('analysis'))
    }
    while (backgroundMayRun() && background.length > 0) {
      const next = background.shift()!
      active += 1
      backgroundActive += 1
      next(makeRelease('background'))
    }
  }

  function tryAcquire(): Release | null {
    if (active >= limit) return null
    active += 1
    return makeRelease('analysis')
  }

  function acquire(): Promise<Release | null> {
    const now = tryAcquire()
    if (now) return Promise.resolve(now)
    if (analyses.length >= opts.maxWaiting) return Promise.resolve(null)
    return new Promise((resolve) => {
      const waiter = (release: Release | null) => {
        clearTimeout(timer)
        resolve(release)
      }
      const timer = setTimeout(() => {
        const at = analyses.indexOf(waiter)
        if (at >= 0) analyses.splice(at, 1)
        resolve(null)
        dispatch() // the hypotheses may go on now that no analysis waits
      }, opts.maxWaitMs)
      analyses.push(waiter)
    })
  }

  function acquireBackground(): Promise<Release> {
    if (background.length === 0 && backgroundMayRun()) {
      active += 1
      backgroundActive += 1
      return Promise.resolve(makeRelease('background'))
    }
    return new Promise((resolve) => { background.push(resolve) })
  }

  return {
    tryAcquire,
    acquire,
    acquireBackground,
    active: () => active,
    waiting: () => analyses.length + background.length,
    backgroundActive: () => backgroundActive,
    limit,
    backgroundLimit,
  }
}

/** The process-wide slots of Point A AI jobs (created on first use from the environment). */
export function pointAAiSlots(): PointAAiSlots {
  const store = globalThis as Record<symbol, PointAAiSlots | undefined>
  store[KEY] ??= createPointAAiSlots({
    limit: intFromEnv('POINT_A_AI_MAX_CONCURRENCY', 2),
    maxWaiting: intFromEnv('POINT_A_AI_MAX_WAITING', 50),
    maxWaitMs: intFromEnv('POINT_A_AI_SLOT_WAIT_MS', 10 * 60_000),
  })
  return store[KEY]!
}

/**
 * A slot for work nobody waits for (the AI hypotheses, RA-2): it is never refused. On the Point A
 * slots it waits in their background queue, behind every analysis (NV-1). On a plain semaphore (a
 * test's) it asks again after POINT_A_AI_SLOT_RETRY_MS (default 5 s) until it has one.
 */
export async function acquirePatiently(slots: Semaphore | PointAAiSlots = pointAAiSlots()): Promise<Release> {
  if ('acquireBackground' in slots) return slots.acquireBackground()
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
