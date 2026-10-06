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

export async function claimDueTasks(limit: number, leaseSeconds: number): Promise<AgentTaskRow[]> {
  return prisma.$queryRaw<AgentTaskRow[]>`
    SELECT ${TASK_COLUMNS} FROM public.agent_claim_tasks(${limit}::int, ${leaseSeconds}::int, NULL::text[])`
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

/** USD spent today (UTC day) by an agent, a company, or the whole platform. */
export async function spendToday(filter: { agentKey?: string; companyId?: string } = {}): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ s: unknown }>>`
    SELECT coalesce(sum(cost_usd), 0) AS s FROM public.agent_runs
    WHERE started_at >= date_trunc('day', now())
      AND (${filter.agentKey ?? null}::text IS NULL OR agent_key = ${filter.agentKey ?? null})
      AND (${filter.companyId ?? null}::text IS NULL OR company_id = ${filter.companyId ?? null})`
  return num(rows[0]?.s)
}

export async function getTask(taskId: string): Promise<(AgentTaskRow & { run_after: Date }) | null> {
  const rows = await prisma.$queryRaw<Array<AgentTaskRow & { run_after: Date }>>`
    SELECT ${TASK_COLUMNS}, run_after FROM public.agent_tasks WHERE id = ${taskId}::uuid`
  return rows[0] ?? null
}
