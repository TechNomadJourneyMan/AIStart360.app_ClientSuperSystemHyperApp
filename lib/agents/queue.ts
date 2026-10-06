/**
 * lib/agents/queue.ts — enqueue, execute and maintain agent tasks.
 *
 * Execution paths (any of them may pick a task up; the atomic claim in
 * Postgres guarantees a task runs once at a time):
 *   1. fast path: right after enqueue, in the background of the same request
 *      (Vercel waitUntil) — unless AGENT_INLINE_EXECUTION=false;
 *   2. Inngest event `agents/task.requested` (when Inngest is configured);
 *   3. Inngest cron `agents-maintenance` every minute: reaps expired leases,
 *      expires approvals, drains due tasks (retries after backoff);
 *   4. GET /api/cron/agents (Bearer CRON_SECRET) — same as 3, for any scheduler.
 */
import { runInBackground } from '@/lib/background'
import { inngest } from '@/lib/inngest'
import { getAgent, listAgents } from './registry'
import { runClaimedTask, type RunReport } from './runner'
import type { AgentDefinition, AgentTaskRow } from './types'
import * as store from './store'

export const AGENT_TASK_REQUESTED_EVENT = 'agents/task.requested'

export interface EnqueueOptions extends Omit<store.EnqueueInput, 'maxAttempts'> {
  /** Kick execution immediately (default true). */
  kick?: boolean
}

/** enqueueAgentTask on a disabled agent (expected; event dispatch skips it). */
export class AgentDisabledError extends Error {
  constructor(readonly agentKey: string) {
    super(`agent ${agentKey} is disabled`)
    this.name = 'AgentDisabledError'
  }
}

export async function enqueueAgentTask(opts: EnqueueOptions): Promise<{ id: string; created: boolean }> {
  const def = getAgent(opts.agentKey)
  if (!def) throw new Error(`unknown agent ${opts.agentKey}`)
  if (def.scope === 'company' && !opts.companyId) throw new Error(`agent ${def.key} needs a company`)
  const config = await store.loadConfig(def.key)
  if (config && !config.enabled) {
    throw new AgentDisabledError(def.key)
  }
  const res = await store.insertTask({ ...opts, maxAttempts: def.limits.maxAttempts })
  if (res.created && opts.kick !== false) kickTask(res.id)
  return res
}

function inngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY) || process.env.INNGEST_DEV === '1'
}

/** Start execution of a task without waiting for it. Never throws. */
export function kickTask(taskId: string): void {
  if (inngestConfigured()) {
    inngest.send({ name: AGENT_TASK_REQUESTED_EVENT, data: { taskId } }).catch((err: unknown) => {
      console.error('[agents] inngest send failed', err instanceof Error ? err.message : err)
    })
  }
  if (process.env.AGENT_INLINE_EXECUTION !== 'false') {
    void runInBackground(`agent-task:${taskId}`, () => executeTaskById(taskId))
  }
}

/** Claim a specific task and run it. Returns null when someone else holds it or it is not due. */
export async function executeTaskById(taskId: string): Promise<RunReport | null> {
  const task = await store.getTask(taskId)
  if (!task) return null
  const def = getAgent(task.agent_key)
  if (!def) {
    console.error(`[agents] task ${taskId}: unknown agent ${task.agent_key}`)
    return null
  }
  const claimed = await store.claimTask(taskId, def.limits.leaseSeconds)
  if (!claimed) return null
  return afterRun(await runClaimedTask(claimed, def), claimed)
}

async function afterRun(report: RunReport, task: Pick<AgentTaskRow, 'agent_key' | 'company_id' | 'session_id'>): Promise<RunReport> {
  const agentKey = task.agent_key
  const companyId = task.company_id
  if (report.finalStatus === 'dead' && task.session_id) {
    // A pipeline stage that gave up ends its diagnostic session: nothing after it can run.
    const { endSession } = await import('@/lib/diagnostics/sessions')
    await endSession(task.session_id, 'failed', `Этап «${agentKey}» не выполнен: ${report.errorCode ?? 'ошибка'}`)
      .catch((err) => console.error('[agents] session fail failed', err instanceof Error ? err.message : err))
  }
  if (report.finalStatus === 'dead') {
    // Lazy import: platform events import this module for subscriptions.
    const { emitPlatformEvent } = await import('@/lib/events/platform')
    await emitPlatformEvent({
      name: 'AGENT_FAILED',
      companyId,
      subjectType: 'agent_task',
      subjectId: report.taskId,
      actor: `agent:${agentKey}`,
      payload: { agent_key: agentKey, error_code: report.errorCode, run_id: report.runId },
      dedupeKey: `agent_failed:${report.taskId}`,
    }).catch((err) => console.error('[agents] AGENT_FAILED emit failed', err))
  }
  return report
}

export interface DrainResult {
  reaped: number
  approvalsExpired: number
  /** Diagnostic sessions failed because their pipeline cannot continue. */
  sessionsFailed: number
  executed: RunReport[]
}

/** Time kept free at the end of a drain for its tail (stalled sessions, bot housekeeping). */
const DRAIN_TAIL_MS = 10_000
/** Worst case of one gateway LLM call: 2 attempts × 60 s timeout + backoff. */
const LLM_CALL_WORST_MS = 125_000
/** Bookkeeping, tools and DB work of a run besides its model calls. */
const RUN_BASE_MS = 60_000

/**
 * Worst-case wall time of one run of `def`: limits.maxRunSeconds when the
 * agent declares it, else its model calls at their worst plus a base, never
 * more than its lease (a run outliving its lease is reaped anyway).
 */
export function worstCaseRunMs(def: AgentDefinition<any>): number {
  if (def.limits.maxRunSeconds) return def.limits.maxRunSeconds * 1000
  return Math.min(def.limits.leaseSeconds * 1000, RUN_BASE_MS + def.limits.maxLlmCalls * LLM_CALL_WORST_MS)
}

/**
 * Maintenance + drain. Runs due tasks one by one while `budgetMs` lasts, and
 * claims a task only when its agent's worst-case run still fits before
 * `maxDurationMs` (the invocation's hard limit, default 300 s = maxDuration of
 * /api/inngest and /api/cron/agents) — a run started too late would be killed
 * mid-way, burn an attempt and lose its spend record. A claimed task's lease
 * is at least its agent's own lease.
 */
export async function drainQueue(opts: { limit?: number; budgetMs?: number; maxDurationMs?: number } = {}): Promise<DrainResult> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 240_000
  const maxDurationMs = opts.maxDurationMs ?? 300_000
  const limit = opts.limit ?? 20
  const reaped = await store.reapExpiredLeases()
  const approvalsExpired = await store.expireApprovals()
  const executed: RunReport[] = []

  // Only agents this deployment knows: during a rolling deploy an older
  // instance must not pick up (and fail) tasks of an agent added later.
  const known = listAgents()
  while (executed.length < limit && Date.now() - started < budgetMs) {
    const elapsed = Date.now() - started
    const fitting = known.filter((a) => elapsed + worstCaseRunMs(a) + DRAIN_TAIL_MS <= maxDurationMs)
    if (!fitting.length) break
    const lease = Math.max(...fitting.map((a) => a.limits.leaseSeconds))
    const [task] = await store.claimDueTasks(1, lease, fitting.map((a) => a.key))
    if (!task) break
    const def = getAgent(task.agent_key)
    if (!def) {
      await store.finishTask({
        taskId: task.id, leaseToken: task.lease_token!, outcome: 'failed',
        errorCode: 'UNKNOWN_AGENT', error: `agent ${task.agent_key} is not registered`, retryable: false,
      })
      continue
    }
    executed.push(await afterRun(await runClaimedTask(task, def), task))
  }
  const { failStalledSessions } = await import('@/lib/diagnostics/sessions')
  const sessionsFailed = (await failStalledSessions()).length
  // Telegram bots: expired conversation state and old update ids (095); never throws.
  await (await import('@/lib/telegram/bots/store')).purgeBotHousekeeping()
  return { reaped, approvalsExpired, sessionsFailed, executed }
}
