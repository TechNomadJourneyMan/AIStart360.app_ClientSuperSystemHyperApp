/**
 * lib/functions/limits.ts — shared limits of the Inngest functions (BE-05 / BE-06).
 *
 * Concurrency: the project rule is at most two pieces of background work at a time (every run
 * holds Prisma / Supabase connections; five at once starved the pooler, 2026-10-15). A limit only
 * per conversation or per company does not bound the total: 30 conversations meant 30 processors.
 * INNGEST_FUNCTION_CONCURRENCY is the function-wide limit of the event-driven processors.
 *
 * Timeouts (Inngest `timeouts`):
 *   - start: how long a run may wait in Inngest's queue before it starts. A cron run that waited
 *     longer than its period is useless (the next one is already due); an event whose work is also
 *     kept in a Postgres queue (agents, Point A recalcs) is picked up from there;
 *   - finish: how long a started run may take in all, sleeps included. NOT a per-request limit:
 *     Inngest cancels the run (and frees its concurrency slot) but an HTTP step already executing
 *     in this process goes on. So `finish` is set ABOVE the longest legitimate run — a lower value
 *     would let a second run start beside one that is still working. Its purpose is the run that
 *     never ends (a lost step, a sleep that should not be there).
 * The per-unit-of-work rule (≤ 45 s) is enforced inside the work (budgets, AI deadlines,
 * lib/runtime/deadline.ts), not by these values.
 *
 * Inngest reads the configuration at sync time: a change of the env value needs a redeploy + sync.
 */

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

export const INNGEST_FUNCTION_CONCURRENCY = intFromEnv('INNGEST_FUNCTION_CONCURRENCY', 2)
