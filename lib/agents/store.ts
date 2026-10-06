/**
 * lib/agents/store.ts — persistence of the agent runtime (migration 086).
 *
 * Uses the server's direct Postgres connection (Prisma, DATABASE_URL, owner
 * role) — the same privileges as the service role, and testable against the
 * local prod-mirror database. All statements are parameterised ($queryRaw tag).
 * Queue transitions go through the SECURITY DEFINER functions of 086 so that
 * leases are atomic.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { Decision, Permission } from './permissions'
import { isPermission } from './permissions'
import type { AgentTaskRow, SourceRef, TaskTrigger } from './types'

const json = (v: unknown) => JSON.stringify(v ?? {})
const num = (v: unknown): number => (v == null ? 0 : Number(v))
/**
 * USD amounts are bound as text and cast in SQL: Prisma prepares a raw
 * statement with the type of the first value it saw, so a JS float bound to a
 * NUMERIC column after an integer (0 for runs without a model) fails with
 * 22P03 "incorrect binary data format".
 */
const costText = (v: number): string => (Number.isFinite(v) ? v.toFixed(8) : '0')

export interface AgentConfigRow {
  agent_key: string
  enabled: boolean
  tier_override: string | null
  model_override: string | null
  schedule_cron: string | null
  per_run_budget_usd: number | null
  daily_budget_usd: number | null
  max_output_tokens: number | null
  settings: Record<string, unknown>
}

export async function loadConfig(agentKey: string): Promise<AgentConfigRow | null> {
  const rows = await prisma.$queryRaw<AgentConfigRow[]>`
    SELECT agent_key, enabled, tier_override, model_override, schedule_cron,
           per_run_budget_usd, daily_budget_usd, max_output_tokens, settings
    FROM public.agent_configs WHERE agent_key = ${agentKey}`
  const r = rows[0]
  if (!r) return null
  return {
    ...r,
    per_run_budget_usd: r.per_run_budget_usd == null ? null : num(r.per_run_budget_usd),
    daily_budget_usd: r.daily_budget_usd == null ? null : num(r.daily_budget_usd),
  }
}

export async function loadGrants(agentKey: string): Promise<Partial<Record<Permission, Decision>>> {
  const rows = await prisma.$queryRaw<Array<{ permission: string; decision: Decision }>>`
    SELECT permission, decision FROM public.agent_permission_grants WHERE agent_key = ${agentKey}`
  const out: Partial<Record<Permission, Decision>> = {}
  for (const r of rows) if (isPermission(r.permission)) out[r.permission] = r.decision
  return out
}

export interface EnqueueInput {
  agentKey: string
  companyId: string | null
  sessionId?: string | null
  parentTaskId?: string | null
  trigger: TaskTrigger
  triggerRef?: string | null
  requestedBy?: string | null
  input?: Record<string, unknown>
  idempotencyKey?: string | null
  priority?: number
  maxAttempts?: number
  runAfter?: Date | null
}

/** Insert a task; with an idempotency key a repeat returns the existing task. */
export async function insertTask(t: EnqueueInput): Promise<{ id: string; created: boolean }> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.agent_tasks
      (agent_key, company_id, session_id, parent_task_id, trigger, trigger_ref, requested_by,
       input, idempotency_key, priority, max_attempts, run_after)
    VALUES (${t.agentKey}, ${t.companyId}, ${t.sessionId ?? null}::uuid, ${t.parentTaskId ?? null}::uuid,
            ${t.trigger}, ${t.triggerRef ?? null}, ${t.requestedBy ?? null},
            ${json(t.input)}::jsonb, ${t.idempotencyKey ?? null}, ${t.priority ?? 5},
            ${t.maxAttempts ?? 3}, ${t.runAfter ?? new Date()})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id`
  if (rows[0]) return { id: rows[0].id, created: true }
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.agent_tasks WHERE idempotency_key = ${t.idempotencyKey ?? null}`
  if (!existing[0]) throw new Error('agent task insert returned nothing')
  return { id: existing[0].id, created: false }
}

const TASK_COLUMNS = Prisma.sql`id, agent_key, company_id, session_id, parent_task_id, trigger, trigger_ref,
  requested_by, input, status, attempts, max_attempts, lease_token`

export async function claimTask(taskId: string, leaseSeconds: number): Promise<AgentTaskRow | null> {
  const rows = await prisma.$queryRaw<AgentTaskRow[]>`
    SELECT ${TASK_COLUMNS} FROM public.agent_claim_task(${taskId}::uuid, ${leaseSeconds}::int)`
  return rows[0] ?? null
}

/** Claim due tasks, only of `agentKeys` when given (the agents this deployment can run). */
export async function claimDueTasks(limit: number, leaseSeconds: number, agentKeys: string[] | null = null): Promise<AgentTaskRow[]> {
  return prisma.$queryRaw<AgentTaskRow[]>`
    SELECT ${TASK_COLUMNS} FROM public.agent_claim_tasks(${limit}::int, ${leaseSeconds}::int, ${agentKeys}::text[])`
}

export type FinishOutcome = 'succeeded' | 'failed' | 'awaiting_approval' | 'cancelled'

export async function finishTask(args: {
  taskId: string
  leaseToken: string
  outcome: FinishOutcome
  errorCode?: string | null
  error?: string | null
  result?: Record<string, unknown> | null
  retryable?: boolean
}): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ s: string | null }>>`
    SELECT public.agent_finish_task(
      ${args.taskId}::uuid, ${args.leaseToken}::uuid, ${args.outcome},
      ${args.errorCode ?? null}, ${args.error ?? null},
      ${args.result ? json(args.result) : null}::jsonb, ${args.retryable ?? true}
    ) AS s`
  return rows[0]?.s ?? null
}

/**
 * Finish a claimed task of a disabled agent as cancelled (AGENT_DISABLED)
 * without running it. Returns the final status, or null when the lease was lost.
 */
export async function cancelDisabledTask(taskId: string, leaseToken: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ status: string }>>`
    UPDATE public.agent_tasks
    SET status = 'cancelled', lease_token = NULL, lease_until = NULL, finished_at = now(),
        last_error_code = 'AGENT_DISABLED', last_error = 'агент выключен'
    WHERE id = ${taskId}::uuid AND status = 'running' AND lease_token = ${leaseToken}::uuid
    RETURNING status`
  return rows[0]?.status ?? null
}

/**
 * The runner just parked a task on `approvalId`, but a human may already have
 * decided it while the run was finishing (decideApproval leaves a 'running'
 * task alone). Apply that decision: approved → re-queue, rejected → cancel.
 * Returns the new task status, or null when there was nothing to apply.
 */
export async function applyEarlyApprovalDecision(taskId: string, approvalId: string): Promise<'queued' | 'cancelled' | null> {
  const rows = await prisma.$queryRaw<Array<{ status: 'queued' | 'cancelled' }>>`
    UPDATE public.agent_tasks t
    SET status          = CASE WHEN a.status = 'approved' THEN 'queued' ELSE 'cancelled' END,
        run_after       = CASE WHEN a.status = 'approved' THEN now() ELSE t.run_after END,
        trigger         = CASE WHEN a.status = 'approved' THEN 'approval' ELSE t.trigger END,
        max_attempts    = CASE WHEN a.status = 'approved' THEN least(10, greatest(t.max_attempts, t.attempts + 1)) ELSE t.max_attempts END,
        finished_at     = CASE WHEN a.status = 'approved' THEN t.finished_at ELSE now() END,
        last_error_code = CASE WHEN a.status = 'approved' THEN t.last_error_code ELSE 'APPROVAL_REJECTED' END,
        cancelled_by    = CASE WHEN a.status = 'approved' THEN t.cancelled_by ELSE a.decided_by END
    FROM public.agent_approvals a
    WHERE t.id = ${taskId}::uuid AND t.status = 'awaiting_approval'
      AND a.id = ${approvalId}::uuid AND a.task_id = t.id AND a.status IN ('approved', 'rejected')
    RETURNING t.status`
  return rows[0]?.status ?? null
}

export async function reapExpiredLeases(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`SELECT public.agent_reap_expired_leases() AS n`
  return num(rows[0]?.n)
}

export async function expireApprovals(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`SELECT public.agent_expire_approvals() AS n`
  return num(rows[0]?.n)
}

export async function createRun(r: {
  taskId: string
  agentKey: string
  agentVersion: string
  companyId: string | null
  attempt: number
  tier: string
  promptVersion?: string | null
  inputSummary: string
}): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.agent_runs (task_id, agent_key, agent_version, company_id, attempt, tier, prompt_version, input_summary)
    VALUES (${r.taskId}::uuid, ${r.agentKey}, ${r.agentVersion}, ${r.companyId}, ${r.attempt}, ${r.tier},
            ${r.promptVersion ?? null}, ${r.inputSummary.slice(0, 2000)})
    RETURNING id`
  return rows[0].id
}

export async function finishRun(r: {
  runId: string
  status: 'succeeded' | 'failed' | 'awaiting_approval' | 'cancelled'
  model: string | null
  /** ai_providers.key of the provider of the last model call (094). */
  providerKey?: string | null
  outputSummary: string | null
  toolsUsed: string[]
  llmCalls: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  sources: SourceRef[]
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.agent_runs SET
      status = ${r.status}, model = ${r.model}, output_summary = ${r.outputSummary?.slice(0, 4000) ?? null},
      tools_used = ${r.toolsUsed}::text[], llm_calls = ${r.llmCalls}, tokens_in = ${r.tokensIn},
      tokens_out = ${r.tokensOut}, cost_usd = ${costText(r.costUsd)}::text::numeric, sources = ${json(r.sources)}::jsonb,
      error_code = ${r.errorCode ?? null}, error_message = ${r.errorMessage?.slice(0, 2000) ?? null},
      finished_at = now(), duration_ms = (extract(epoch FROM now() - started_at) * 1000)::int
    WHERE id = ${r.runId}::uuid`
  if (r.providerKey) {
    // Separate statement: before migration 094 the column does not exist and
    // the run itself must still be recorded.
    try {
      await prisma.$executeRaw`UPDATE public.agent_runs SET provider_key = ${r.providerKey} WHERE id = ${r.runId}::uuid`
    } catch (err) {
      if (!/provider_key/.test(err instanceof Error ? err.message : '')) throw err
    }
  }
}

export async function insertToolCall(c: {
  runId: string
  seq: number
  tool: string
  permission: string
  decision: Decision
  status: 'ok' | 'error' | 'denied' | 'pending_approval'
  argsRedacted: Record<string, unknown>
  resultSummary?: string | null
  errorCode?: string | null
  approvalId?: string | null
  durationMs?: number | null
}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO public.agent_tool_calls
      (run_id, seq, tool, permission, decision, status, args_redacted, result_summary, error_code, approval_id, duration_ms)
    VALUES (${c.runId}::uuid, ${c.seq}, ${c.tool}, ${c.permission}, ${c.decision}, ${c.status},
            ${json(c.argsRedacted)}::jsonb, ${c.resultSummary?.slice(0, 1000) ?? null}, ${c.errorCode ?? null},
            ${c.approvalId ?? null}::uuid, ${c.durationMs ?? null})`
}

export async function insertEvent(e: {
  taskId: string | null
  runId: string | null
  agentKey: string
  companyId: string | null
  level: 'debug' | 'info' | 'warn' | 'error'
  type: string
  message: string
  data?: Record<string, unknown>
}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO public.agent_events (task_id, run_id, agent_key, company_id, level, type, message, data)
    VALUES (${e.taskId}::uuid, ${e.runId}::uuid, ${e.agentKey}, ${e.companyId}, ${e.level}, ${e.type},
            ${e.message.slice(0, 1000)}, ${json(e.data)}::jsonb)`
}

export async function createApproval(a: {
  taskId: string
  runId: string
  agentKey: string
  companyId: string | null
  tool: string
  permission: string
  summary: string
  payload: Record<string, unknown>
  payloadHash: string
  ttlHours?: number
}): Promise<string> {
  // One pending approval per (task, payload): a retried run reuses it.
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.agent_approvals
    WHERE task_id = ${a.taskId}::uuid AND payload_hash = ${a.payloadHash} AND status = 'pending'`
  if (existing[0]) return existing[0].id
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.agent_approvals
      (task_id, run_id, agent_key, company_id, tool, permission, summary, payload, payload_hash, expires_at)
    VALUES (${a.taskId}::uuid, ${a.runId}::uuid, ${a.agentKey}, ${a.companyId}, ${a.tool}, ${a.permission},
            ${a.summary.slice(0, 500)}, ${json(a.payload)}::jsonb, ${a.payloadHash},
            now() + make_interval(hours => ${a.ttlHours ?? 24}::int))
    RETURNING id`
  return rows[0].id
}

/** An approved, not yet executed approval for exactly this action. */
export async function findApprovedAction(taskId: string, payloadHash: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.agent_approvals
    WHERE task_id = ${taskId}::uuid AND payload_hash = ${payloadHash} AND status = 'approved'
    LIMIT 1`
  return rows[0]?.id ?? null
}

export async function markApprovalExecuted(approvalId: string, ok: boolean): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.agent_approvals
    SET status = ${ok ? 'executed' : 'failed'}, executed_at = now()
    WHERE id = ${approvalId}::uuid AND status = 'approved'`
}

/**
 * Today's model spend (UTC day) of an agent, a company, or the whole platform:
 *   agent_runs.cost_usd — written after every LLM call (settleReservation), not
 *                         only when the run finishes;
 *   ai_budget_reservations — worst-case cost of agent calls still in flight
 *                         (098), so parallel runs see each other;
 *   ai_usage_ledger     — unless filtered by agent: model calls of non-agent
 *                         features (093); the platform and company budgets
 *                         cover all AI usage, not only agents.
 */
export async function spendToday(filter: { agentKey?: string; companyId?: string } = {}): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ s: unknown }>>`
    SELECT coalesce(sum(cost_usd), 0) AS s FROM public.agent_runs
    WHERE started_at >= date_trunc('day', now())
      AND (${filter.agentKey ?? null}::text IS NULL OR agent_key = ${filter.agentKey ?? null})
      AND (${filter.companyId ?? null}::text IS NULL OR company_id = ${filter.companyId ?? null})`
  let total = num(rows[0]?.s)
  try {
    const reserved = await prisma.$queryRaw<Array<{ s: unknown }>>`
      SELECT coalesce(sum(amount_usd), 0) AS s FROM public.ai_budget_reservations
      WHERE created_at >= date_trunc('day', now())
        AND (${filter.agentKey ?? null}::text IS NULL OR agent_key = ${filter.agentKey ?? null})
        AND (${filter.companyId ?? null}::text IS NULL OR company_id = ${filter.companyId ?? null})`
    total += num(reserved[0]?.s)
  } catch (err) {
    // Before migration 098 there are no reservations.
    if (!/ai_budget_reservations/.test(err instanceof Error ? err.message : '')) throw err
  }
  if (!filter.agentKey) {
    try {
      const ledger = await prisma.$queryRaw<Array<{ s: unknown }>>`
        SELECT coalesce(sum(cost_usd), 0) AS s FROM public.ai_usage_ledger
        WHERE created_at >= date_trunc('day', now())
          AND (${filter.companyId ?? null}::text IS NULL OR company_id = ${filter.companyId ?? null})`
      total += num(ledger[0]?.s)
    } catch (err) {
      // Before migration 093 the ledger does not exist: agents only.
      if (!/ai_usage_ledger/.test(err instanceof Error ? err.message : '')) throw err
    }
  }
  return total
}

export type BudgetScope = 'agent' | 'company' | 'platform'

/**
 * Reserve `amountUsd` (a call's worst case) against today's agent, company and
 * platform budgets. Check and insert run under one transaction-scoped advisory
 * lock, so concurrent runs cannot all pass the check on the same stale total
 * and jointly overshoot a budget. Returns the exceeded scope when the
 * reservation would not fit. A budget of null is not checked.
 */
export async function reserveBudget(r: {
  runId: string
  agentKey: string
  companyId: string | null
  amountUsd: number
  agentDailyUsd: number
  companyDailyUsd: number | null
  platformDailyUsd: number
}): Promise<{ ok: true; reservationId: string | null } | { ok: false; scope: BudgetScope }> {
  const amount = costText(Math.max(0, r.amountUsd))
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai_budget_reservations'))`
      const [s] = await tx.$queryRaw<Array<{ agent: unknown; company: unknown; platform: unknown }>>`
        WITH runs AS (
          SELECT agent_key, company_id, cost_usd AS c FROM public.agent_runs WHERE started_at >= date_trunc('day', now())
        ), held AS (
          SELECT agent_key, company_id, amount_usd AS c FROM public.ai_budget_reservations WHERE created_at >= date_trunc('day', now())
        ), ledger AS (
          SELECT company_id, cost_usd AS c FROM public.ai_usage_ledger WHERE created_at >= date_trunc('day', now())
        )
        SELECT
          (SELECT coalesce(sum(c), 0) FROM runs WHERE agent_key = ${r.agentKey})
            + (SELECT coalesce(sum(c), 0) FROM held WHERE agent_key = ${r.agentKey}) AS agent,
          (SELECT coalesce(sum(c), 0) FROM runs WHERE company_id = ${r.companyId}::text)
            + (SELECT coalesce(sum(c), 0) FROM held WHERE company_id = ${r.companyId}::text)
            + (SELECT coalesce(sum(c), 0) FROM ledger WHERE company_id = ${r.companyId}::text) AS company,
          (SELECT coalesce(sum(c), 0) FROM runs) + (SELECT coalesce(sum(c), 0) FROM held)
            + (SELECT coalesce(sum(c), 0) FROM ledger) AS platform`
      const want = Number(amount)
      if (num(s.agent) + want > r.agentDailyUsd) return { ok: false as const, scope: 'agent' as const }
      if (r.companyId && r.companyDailyUsd !== null && num(s.company) + want > r.companyDailyUsd) {
        return { ok: false as const, scope: 'company' as const }
      }
      if (num(s.platform) + want > r.platformDailyUsd) return { ok: false as const, scope: 'platform' as const }
      await tx.$executeRaw`DELETE FROM public.ai_budget_reservations WHERE created_at < now() - interval '2 days'`
      const [row] = await tx.$queryRaw<Array<{ id: unknown }>>`
        INSERT INTO public.ai_budget_reservations (run_id, agent_key, company_id, amount_usd)
        VALUES (${r.runId}::uuid, ${r.agentKey}, ${r.companyId}, ${amount}::text::numeric)
        RETURNING id`
      return { ok: true as const, reservationId: String(row.id) }
    })
  } catch (err) {
    // Before migrations 093/098: no reservation, a plain (unlocked) check.
    if (!/ai_budget_reservations|ai_usage_ledger/.test(err instanceof Error ? err.message : '')) throw err
    const [agent, company, platform] = await Promise.all([
      spendToday({ agentKey: r.agentKey }),
      r.companyId ? spendToday({ companyId: r.companyId }) : Promise.resolve(0),
      spendToday(),
    ])
    const want = Number(amount)
    if (agent + want > r.agentDailyUsd) return { ok: false, scope: 'agent' }
    if (r.companyId && r.companyDailyUsd !== null && company + want > r.companyDailyUsd) return { ok: false, scope: 'company' }
    if (platform + want > r.platformDailyUsd) return { ok: false, scope: 'platform' }
    return { ok: true, reservationId: null }
  }
}

/**
 * After the call: drop the reservation and add the real cost to the run, in
 * one statement, so today's spend never shows the call twice or not at all.
 */
export async function settleReservation(reservationId: string | null, runId: string, costUsd: number): Promise<void> {
  const cost = costText(Math.max(0, costUsd))
  if (reservationId) {
    await prisma.$executeRaw`
      WITH released AS (DELETE FROM public.ai_budget_reservations WHERE id = ${reservationId}::bigint)
      UPDATE public.agent_runs SET cost_usd = cost_usd + ${cost}::text::numeric WHERE id = ${runId}::uuid`
  } else {
    await prisma.$executeRaw`UPDATE public.agent_runs SET cost_usd = cost_usd + ${cost}::text::numeric WHERE id = ${runId}::uuid`
  }
}

export async function getTask(taskId: string): Promise<(AgentTaskRow & { run_after: Date }) | null> {
  const rows = await prisma.$queryRaw<Array<AgentTaskRow & { run_after: Date }>>`
    SELECT ${TASK_COLUMNS}, run_after FROM public.agent_tasks WHERE id = ${taskId}::uuid`
  return rows[0] ?? null
}
