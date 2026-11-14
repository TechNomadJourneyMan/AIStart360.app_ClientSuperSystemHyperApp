/**
 * lib/agents/run-slots.ts — how many agent tasks one process runs at a time (R-017).
 *
 * POST /api/internal/agents/kick starts a task in the background of the request, and so does the
 * inline fast path after an enqueue: without a bound, N tasks queued at once meant N agents in one
 * process — each with its model calls, parsed documents and a Prisma connection — and the agents
 * service (8 GB, shared with the portal's limits) risked running out of memory. The project rule is
 * at most two pieces of background work at a time.
 *
 * Every run of a task goes through executeTaskById (lib/agents/queue.ts) and takes a slot first:
 *   - AGENT_MAX_CONCURRENCY slots (default 2);
 *   - a run that finds none waits for one WITHOUT claiming the task: it stays pending in Postgres,
 *     so the per-minute drain may take it as well (the atomic claim keeps it single);
 *   - at most AGENT_MAX_WAITING runs wait (default 8), none longer than AGENT_SLOT_WAIT_MS
 *     (default 5 min); past that the task is left to the drain — nothing is lost, it only starts
 *     a minute later;
 *   - the drain itself takes a slot without waiting and stops when there is none.
 * The semaphore lives on globalThis: Next bundles a module once per route, and the limit is per process.
 */

export type Release = () => void

export interface Semaphore {
  /** A slot now, or null. */
  tryAcquire(): Release | null
  /** A slot when one frees up; null when the queue is full or the wait timed out. */
  acquire(): Promise<Release | null>
  active(): number
  waiting(): number
  readonly limit: number
}

export interface SemaphoreOptions {
  limit: number
  maxWaiting: number
  maxWaitMs: number
}

export function createSemaphore(opts: SemaphoreOptions): Semaphore {
  const limit = Math.max(1, Math.floor(opts.limit))
  let active = 0
  const queue: Array<(release: Release | null) => void> = []

  function makeRelease(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = queue.shift()
      if (next) next(makeRelease()) // the slot passes on: `active` stays the same
      else active -= 1
    }
  }

  function tryAcquire(): Release | null {
    if (active >= limit) return null
    active += 1
    return makeRelease()
  }

  function acquire(): Promise<Release | null> {
    const now = tryAcquire()
    if (now) return Promise.resolve(now)
    if (queue.length >= opts.maxWaiting) return Promise.resolve(null)
    return new Promise((resolve) => {
      const waiter = (release: Release | null) => {
        clearTimeout(timer)
        resolve(release)
      }
      const timer = setTimeout(() => {
        const at = queue.indexOf(waiter)
        if (at >= 0) queue.splice(at, 1)
        resolve(null)
      }, opts.maxWaitMs)
      queue.push(waiter)
    })
  }

  return { tryAcquire, acquire, active: () => active, waiting: () => queue.length, limit }
}

const KEY = Symbol.for('aistart360.agents.runSlots')

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/** The process-wide slots of agent runs (created on first use from the environment). */
export function agentRunSlots(): Semaphore {
  const store = globalThis as Record<symbol, Semaphore | undefined>
  store[KEY] ??= createSemaphore({
    limit: intFromEnv('AGENT_MAX_CONCURRENCY', 2),
    maxWaiting: intFromEnv('AGENT_MAX_WAITING', 8),
    maxWaitMs: intFromEnv('AGENT_SLOT_WAIT_MS', 5 * 60_000),
  })
  return store[KEY]!
}

/** Tests only: forget the slots so the next call reads the environment again. */
export function resetAgentRunSlotsForTests(): void {
  delete (globalThis as Record<symbol, unknown>)[KEY]
}
