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
    concurrency: { limit: 10 },
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
    const scheduled = await enqueueScheduledAgents(new Date())
    const redispatched = await redispatchPending()
    // WhatsApp outbox first (bounded, seconds): retries must not wait behind a long agent drain.
    const whatsapp = await drainWhatsAppOutbox({ limit: 50, budgetMs: 30_000 }).catch(() => null)
    const drained = await drainQueue({ budgetMs: 240_000 })
    return {
      scheduled,
      redispatched,
      reaped: drained.reaped,
      approvalsExpired: drained.approvalsExpired,
      sessionsFailed: drained.sessionsFailed,
      executed: drained.executed.length,
      whatsapp,
    }
  },
)

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
