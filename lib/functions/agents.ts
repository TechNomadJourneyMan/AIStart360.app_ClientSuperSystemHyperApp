import { inngest } from '@/lib/inngest'
import { AGENT_TASK_REQUESTED_EVENT, drainQueue, enqueueAgentTask, executeTaskById } from '@/lib/agents/queue'
import { listAgents } from '@/lib/agents/registry'
import { loadConfig } from '@/lib/agents/store'
import { redispatchPending } from '@/lib/events/platform'
import { cronMatches } from '@/lib/agents/cron'
import { drainWhatsAppOutbox } from '@/lib/whatsapp/outbox'

/**
 * Inngest wiring of the agent runtime (docs/platform/05-agents.md).
 * inngest 4.x registers triggers only via `triggers: [...]` (a top-level
 * `event`/`cron` option is silently ignored).
 */

/** Fast path: run the requested task now. The DB claim makes duplicates harmless. */
export const agentsTaskRequested = inngest.createFunction(
  {
    id: 'agents-task-requested',
    retries: 0, // retries are the queue's job (backoff + dead-letter in Postgres)
    // Each run holds DB connections (Prisma pool of 5) — 2 at a time keeps the
    // Supabase pooler free for the site (5 starved it, 2026-10-15).
    concurrency: { limit: 2 },
    triggers: [{ event: AGENT_TASK_REQUESTED_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event }: { event: { data: { taskId?: string } } }) => {
    const taskId = event.data?.taskId
    if (!taskId) return { skipped: 'no taskId' }
    const report = await executeTaskById(taskId)
    return report ?? { skipped: 'not claimable' }
  },
)

/**
 * Every minute: reap expired leases, expire approvals, re-dispatch stuck
 * platform events, enqueue scheduled agents whose cron matches, drain the queue.
 */
export const agentsMaintenance = inngest.createFunction(
  {
    id: 'agents-maintenance',
    retries: 0,
    concurrency: { limit: 1 },
    triggers: [{ cron: '* * * * *' }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async () => {
    // «Агенты по расписанию (24/7)» off (default): no scheduled agents, and the
    // queue upkeep runs every 15 minutes instead of every minute — the site's
    // database is not kept busy around the clock. Event-driven tasks still run
    // at once through agentsTaskRequested.
    const now = new Date()
    const around = await scheduledAgentsOn()
    if (!around && now.getUTCMinutes() % 15 !== 0) return { skipped: 'quiet_mode' }
    const scheduled = around ? await enqueueScheduledAgents(now) : []
    const redispatched = await redispatchPending()
    // WhatsApp outbox first (bounded, seconds): retries must not wait behind a long agent drain.
    // A run every minute must END within the minute: budgets ~45 s in total.
    // Long budgets (270 s) made every run hit the 300 s timeout holding DB
    // connections, and the overlapping runs starved the pooler → site 504
    // (2026-10-15).
    const whatsapp = await drainWhatsAppOutbox({ limit: 50, budgetMs: 10_000 }).catch(() => null)
    // Point A recalculations that are due (works without Inngest too).
    const pointA = await import('@/lib/point-a/recalc-queue')
      .then((q) => q.drainPointARecalc({ budgetMs: 15_000 }))
      .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
    const drained = await drainQueue({ budgetMs: 20_000 })
    return {
      scheduled,
      redispatched,
      reaped: drained.reaped,
      approvalsExpired: drained.approvalsExpired,
      sessionsFailed: drained.sessionsFailed,
      executed: drained.executed.length,
      whatsapp,
      pointA,
    }
  },
)

/** The «Агенты по расписанию (24/7)» setting (off unless an admin turns it on). */
export async function scheduledAgentsOn(): Promise<boolean> {
  const { getSetting } = await import('@/lib/settings/store')
  return getSetting('agents_scheduled').catch(() => false)
}

/** Platform-scope agents with a cron (definition or admin override) get one task per matching minute. */
export async function enqueueScheduledAgents(now: Date): Promise<string[]> {
  const started: string[] = []
  for (const def of listAgents()) {
    if (def.scope !== 'platform') continue
    const config = await loadConfig(def.key)
    if (config && !config.enabled) continue
    const cron = config?.schedule_cron ?? def.triggers?.cron
    if (!cron || !cronMatches(cron, now)) continue
    const minute = now.toISOString().slice(0, 16)
    const res = await enqueueAgentTask({
      agentKey: def.key,
      companyId: null,
      trigger: 'schedule',
      triggerRef: cron,
      requestedBy: 'system:schedule',
      idempotencyKey: `schedule:${def.key}:${minute}`,
      kick: false,
    })
    if (res.created) started.push(def.key)
  }
  return started
}
