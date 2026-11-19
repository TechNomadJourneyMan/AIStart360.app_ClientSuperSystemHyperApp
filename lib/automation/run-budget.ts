/**
 * lib/automation/run-budget.ts — the time budget of the automatic client / staff mailings (R-015):
 * the crons reminders, client-digest and staff-digest.
 *
 * On Railway `export const maxDuration` does nothing (`next start` has no per-request limit) and the
 * Resend SDK has no timeout, so a provider that never answered held the run — ten clients at a time —
 * for as long as it liked. The platform's rule for background work: at most 2 at a time, the run
 * within 45 s. Each run therefore gets a budget (≤ 44 s from its start, ≤ 2 at a time) and keeps it
 * the way GET /api/cron/crm-digest does (lib/crm/bounded-run.ts):
 *   • no client / assignee is STARTED with less than `minStartMs` left — the rest are «deferred»
 *     (counted and logged, never dropped silently; their touches are idempotent, the next run
 *     sends what is still due);
 *   • every provider send of one already started is cut at the deadline (beforeDeadline: abandoned,
 *     not cancelled — its late answer is ignored) and counted as «timedOut».
 * Asking for more than 44 s or 2 at a time gets 44 s and 2: these are limits, not defaults.
 */
export const AUTOMATION_RUN_MS = 44_000
export const AUTOMATION_CONCURRENCY = 2
export const AUTOMATION_MIN_START_MS = 10_000

export interface RunBudget {
  /** Absolute time (ms since epoch) by which the run is over. */
  deadlineAt: number
  /** ≤ AUTOMATION_CONCURRENCY. */
  concurrency: number
  /** No item is started with less than this left. */
  minStartMs: number
  now: () => number
}

export function runBudget(opts: { runMs?: number; concurrency?: number; minStartMs?: number; now?: () => number } = {}): RunBudget {
  const now = opts.now ?? Date.now
  const runMs = Math.max(0, Math.min(opts.runMs ?? AUTOMATION_RUN_MS, AUTOMATION_RUN_MS))
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? AUTOMATION_CONCURRENCY, AUTOMATION_CONCURRENCY))
  return { deadlineAt: now() + runMs, concurrency, minStartMs: Math.max(0, opts.minStartMs ?? AUTOMATION_MIN_START_MS), now }
}

/** A stable per-day order: when a run cannot reach everyone, not the same people are left every day. */
export { dayRotation } from '@/lib/crm/bounded-run'
