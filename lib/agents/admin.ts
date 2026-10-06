/**
 * lib/agents/admin.ts — data layer of the Agent Control Center (GIGA «ИИ-агенты»).
 *
 * Read models for agents, tasks, runs, tool calls, events, approvals and
 * costs, plus the few mutations admins may perform (config, permission
 * grants, run / cancel / retry). Route handlers authorise with requireGiga and
 * write the audit log; this module only talks to Postgres (testable on the
 * local prod-mirror DB). Prompts and tool arguments are never returned beyond
 * what the runtime already stores redacted.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { nextCronRun, isValidCron } from './cron'
import { effectivePermissions, PERMISSION_CEILING, PERMISSIONS, type Decision, type Permission } from './permissions'
import { getAgent, listAgents } from './registry'
import { loadConfig, loadGrants } from './store'
import { getTool } from './tools'

const n = (v: unknown) => (v == null ? 0 : Number(v))

export interface AgentStats {
  runs7d: number
  succeeded7d: number
  failed7d: number
  successRate: number | null
  errorRate: number | null
  avgDurationMs: number | null
  tokensIn7d: number
  tokensOut7d: number
  costUsd7d: number
  costUsdToday: number
  queued: number
  running: number
  awaitingApproval: number
  dead24h: number
  lastRunAt: string | null
  lastRunStatus: string | null
}

async function statsByAgent(): Promise<Map<string, AgentStats>> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH r AS (
      SELECT agent_key,
             count(*) FILTER (WHERE started_at > now() - interval '7 days') AS runs7d,
             count(*) FILTER (WHERE started_at > now() - interval '7 days' AND status = 'succeeded') AS ok7d,
             count(*) FILTER (WHERE started_at > now() - interval '7 days' AND status = 'failed') AS failed7d,
             avg(duration_ms) FILTER (WHERE started_at > now() - interval '7 days' AND duration_ms IS NOT NULL) AS avg_ms,
             sum(tokens_in) FILTER (WHERE started_at > now() - interval '7 days') AS tin,
             sum(tokens_out) FILTER (WHERE started_at > now() - interval '7 days') AS tout,
             sum(cost_usd) FILTER (WHERE started_at > now() - interval '7 days') AS cost7d,
             sum(cost_usd) FILTER (WHERE started_at >= date_trunc('day', now())) AS cost_today,
             max(started_at) AS last_at
      FROM public.agent_runs GROUP BY agent_key
    ), last AS (
      SELECT DISTINCT ON (agent_key) agent_key, status AS last_status
      FROM public.agent_runs ORDER BY agent_key, started_at DESC
    ), t AS (
      SELECT agent_key,
             count(*) FILTER (WHERE status = 'queued') AS queued,
             count(*) FILTER (WHERE status = 'running') AS running,
             count(*) FILTER (WHERE status = 'awaiting_approval') AS awaiting,
             count(*) FILTER (WHERE status = 'dead' AND finished_at > now() - interval '24 hours') AS dead24h
      FROM public.agent_tasks GROUP BY agent_key
    )
    SELECT coalesce(r.agent_key, t.agent_key) AS agent_key, r.runs7d, r.ok7d, r.failed7d, r.avg_ms, r.tin, r.tout,
           r.cost7d, r.cost_today, r.last_at, last.last_status, t.queued, t.running, t.awaiting, t.dead24h
    FROM r FULL OUTER JOIN t ON t.agent_key = r.agent_key
    LEFT JOIN last ON last.agent_key = coalesce(r.agent_key, t.agent_key)`
  const out = new Map<string, AgentStats>()
  for (const r of rows) {
    const runs = n(r.runs7d)
    out.set(String(r.agent_key), {
      runs7d: runs,
      succeeded7d: n(r.ok7d),
      failed7d: n(r.failed7d),
      successRate: runs ? n(r.ok7d) / runs : null,
      errorRate: runs ? n(r.failed7d) / runs : null,
      avgDurationMs: r.avg_ms == null ? null : Math.round(n(r.avg_ms)),
      tokensIn7d: n(r.tin),
      tokensOut7d: n(r.tout),
      costUsd7d: n(r.cost7d),
      costUsdToday: n(r.cost_today),
      queued: n(r.queued),
      running: n(r.running),
      awaitingApproval: n(r.awaiting),
      dead24h: n(r.dead24h),
      lastRunAt: r.last_at ? new Date(r.last_at as Date).toISOString() : null,
      lastRunStatus: (r.last_status as string | null) ?? null,
    })
  }
  return out
}

const EMPTY_STATS: AgentStats = {
  runs7d: 0, succeeded7d: 0, failed7d: 0, successRate: null, errorRate: null, avgDurationMs: null,
  tokensIn7d: 0, tokensOut7d: 0, costUsd7d: 0, costUsdToday: 0, queued: 0, running: 0, awaitingApproval: 0,
  dead24h: 0, lastRunAt: null, lastRunStatus: null,
}

export interface AgentOverview {
  key: string
  name: string
  description: string
  version: string
  scope: 'company' | 'platform'
  enabled: boolean
  tier: string
  model: string | null
  promptVersion: string | null
  tools: Array<{ name: string; permission: string; description: string }>
  triggers: { events: string[]; cron: string | null }
  nextRunAt: string | null
  limits: { perRunBudgetUsd: number; dailyBudgetUsd: number; maxOutputTokens: number; maxAttempts: number }
  permissions: Record<Permission, Decision>
  stats: AgentStats
}

export async function listAgentOverviews(now = new Date()): Promise<AgentOverview[]> {
  const stats = await statsByAgent()
  const out: AgentOverview[] = []
  for (const def of listAgents()) {
    const [config, grants] = await Promise.all([loadConfig(def.key), loadGrants(def.key)])
    const cron = config?.schedule_cron ?? def.triggers?.cron ?? null
    const enabled = config ? config.enabled : true
    out.push({
      key: def.key,
      name: def.name,
      description: def.description,
      version: def.version,
      scope: def.scope,
      enabled,
      tier: config?.tier_override ?? def.tier,
      model: config?.model_override ?? null,
      promptVersion: def.promptVersion ?? null,
      tools: def.tools.map((t) => {
        const tool = getTool(t)
        return { name: t, permission: tool?.permission ?? 'UNKNOWN', description: tool?.description ?? '' }
      }),
      triggers: { events: [...(def.triggers?.events ?? [])], cron },
      nextRunAt: enabled && cron && def.scope === 'platform' ? nextCronRun(cron, now)?.toISOString() ?? null : null,
      limits: {
        perRunBudgetUsd: config?.per_run_budget_usd ?? def.limits.perRunBudgetUsd,
        dailyBudgetUsd: config?.daily_budget_usd ?? def.limits.dailyBudgetUsd,
        maxOutputTokens: config?.max_output_tokens ?? def.limits.maxOutputTokens,
        maxAttempts: def.limits.maxAttempts,
      },
      permissions: effectivePermissions(def.permissions, grants),
      stats: stats.get(def.key) ?? EMPTY_STATS,
    })
  }
  return out
}

export interface ConfigPatch {
  enabled?: boolean
  tierOverride?: 'light' | 'standard' | 'premium' | null
  modelOverride?: string | null
  scheduleCron?: string | null
  perRunBudgetUsd?: number | null
  dailyBudgetUsd?: number | null
  maxOutputTokens?: number | null
}

export async function updateAgentConfig(key: string, patch: ConfigPatch, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = getAgent(key)
  if (!def) return { ok: false, error: 'unknown_agent' }
  if (patch.scheduleCron && !isValidCron(patch.scheduleCron)) return { ok: false, error: 'invalid_cron' }
  if (patch.scheduleCron && def.scope !== 'platform') return { ok: false, error: 'schedule_only_for_platform_agents' }
  const current = await loadConfig(key)
  const next = {
    enabled: patch.enabled ?? current?.enabled ?? true,
    tier: patch.tierOverride !== undefined ? patch.tierOverride : current?.tier_override ?? null,
    model: patch.modelOverride !== undefined ? patch.modelOverride : current?.model_override ?? null,
    cron: patch.scheduleCron !== undefined ? patch.scheduleCron : current?.schedule_cron ?? null,
    perRun: patch.perRunBudgetUsd !== undefined ? patch.perRunBudgetUsd : current?.per_run_budget_usd ?? null,
    daily: patch.dailyBudgetUsd !== undefined ? patch.dailyBudgetUsd : current?.daily_budget_usd ?? null,
    maxTok: patch.maxOutputTokens !== undefined ? patch.maxOutputTokens : current?.max_output_tokens ?? null,
  }
  await prisma.$executeRaw`
    INSERT INTO public.agent_configs
      (agent_key, enabled, tier_override, model_override, schedule_cron, per_run_budget_usd, daily_budget_usd, max_output_tokens, updated_by)
    VALUES (${key}, ${next.enabled}, ${next.tier}, ${next.model}, ${next.cron}, ${next.perRun}, ${next.daily}, ${next.maxTok}, ${actorId})
    ON CONFLICT (agent_key) DO UPDATE SET
      enabled = EXCLUDED.enabled, tier_override = EXCLUDED.tier_override, model_override = EXCLUDED.model_override,
      schedule_cron = EXCLUDED.schedule_cron, per_run_budget_usd = EXCLUDED.per_run_budget_usd,
      daily_budget_usd = EXCLUDED.daily_budget_usd, max_output_tokens = EXCLUDED.max_output_tokens,
      updated_by = EXCLUDED.updated_by`
  return { ok: true }
}

/**
 * Replace an agent's admin grants. A grant above the code ceiling is stored
 * but has no effect (effective = most restrictive); the response says so.
 */
export async function setAgentGrants(
  key: string,
  grants: Partial<Record<Permission, Decision | null>>,
  actorId: string,
): Promise<{ ok: true; effective: Record<Permission, Decision>; capped: Permission[] } | { ok: false; error: string }> {
  const def = getAgent(key)
  if (!def) return { ok: false, error: 'unknown_agent' }
  const capped: Permission[] = []
  for (const p of PERMISSIONS) {
    if (!(p in grants)) continue
    const d = grants[p]
    if (d === null) {
      await prisma.$executeRaw`DELETE FROM public.agent_permission_grants WHERE agent_key = ${key} AND permission = ${p}`
      continue
    }
    if (d === 'ALLOW' && PERMISSION_CEILING[p] !== 'ALLOW') capped.push(p)
    await prisma.$executeRaw`
      INSERT INTO public.agent_permission_grants (agent_key, permission, decision, updated_by)
      VALUES (${key}, ${p}, ${d}, ${actorId})
      ON CONFLICT (agent_key, permission) DO UPDATE SET decision = EXCLUDED.decision, updated_by = EXCLUDED.updated_by`
  }
  return { ok: true, effective: effectivePermissions(def.permissions, await loadGrants(key)), capped }
}

export interface TaskFilter {
  status?: string | null
  agentKey?: string | null
  companyId?: string | null
  limit?: number
  before?: string | null // created_at cursor (ISO)
}

export async function listTasks(f: TaskFilter) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200)
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT t.id, t.agent_key, t.company_id, c.name AS company_name, t.trigger, t.trigger_ref, t.requested_by,
           t.status, t.attempts, t.max_attempts, t.run_after, t.last_error_code, t.last_error,
           t.created_at, t.started_at, t.finished_at,
           (SELECT coalesce(sum(cost_usd), 0) FROM public.agent_runs r WHERE r.task_id = t.id) AS cost_usd
    FROM public.agent_tasks t
    LEFT JOIN public.companies c ON c.id = t.company_id
    WHERE (${f.status ?? null}::text IS NULL OR t.status = ${f.status ?? null})
      AND (${f.agentKey ?? null}::text IS NULL OR t.agent_key = ${f.agentKey ?? null})
      AND (${f.companyId ?? null}::text IS NULL OR t.company_id = ${f.companyId ?? null})
      AND (${f.before ?? null}::timestamptz IS NULL OR t.created_at < ${f.before ?? null}::timestamptz)
    ORDER BY t.created_at DESC
    LIMIT ${limit}`
  const items = rows.map((r) => ({ ...r, cost_usd: n(r.cost_usd) }))
  const last = items[items.length - 1] as { created_at?: Date } | undefined
  return { items, nextCursor: items.length === limit && last?.created_at ? new Date(last.created_at).toISOString() : null }
}

export async function getTaskDetail(taskId: string) {
  const [task] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT t.*, c.name AS company_name FROM public.agent_tasks t
    LEFT JOIN public.companies c ON c.id = t.company_id WHERE t.id = ${taskId}::uuid`
  if (!task) return null
  const [runs, toolCalls, events, approvals] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, attempt, status, tier, model, prompt_version, input_summary, output_summary, tools_used, llm_calls,
             tokens_in, tokens_out, cost_usd, sources, error_code, error_message, started_at, finished_at, duration_ms
      FROM public.agent_runs WHERE task_id = ${taskId}::uuid ORDER BY attempt`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT c.id, c.run_id, c.seq, c.tool, c.permission, c.decision, c.status, c.args_redacted, c.result_summary,
             c.error_code, c.approval_id, c.duration_ms, c.created_at
      FROM public.agent_tool_calls c JOIN public.agent_runs r ON r.id = c.run_id
      WHERE r.task_id = ${taskId}::uuid ORDER BY c.id`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, run_id, level, type, message, data, created_at FROM public.agent_events
      WHERE task_id = ${taskId}::uuid ORDER BY id LIMIT 500`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, tool, permission, summary, status, requested_at, expires_at, decided_by, decided_via, decision_reason, decided_at, executed_at
      FROM public.agent_approvals WHERE task_id = ${taskId}::uuid ORDER BY requested_at`,
  ])
  return {
    task,
    runs: runs.map((r) => ({ ...r, cost_usd: n(r.cost_usd) })),
    toolCalls: toolCalls.map((c) => ({ ...c, id: n(c.id) })),
    events: events.map((e) => ({ ...e, id: n(e.id) })),
    approvals,
  }
}

/** Cancel a task that has not finished. */
export async function cancelTask(taskId: string, actorId: string): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE public.agent_tasks
    SET status = 'cancelled', cancelled_by = ${actorId}, finished_at = now(), lease_token = NULL, lease_until = NULL
    WHERE id = ${taskId}::uuid AND status IN ('queued', 'awaiting_approval', 'failed')`
  return count > 0
}

/** Put a dead / failed / cancelled task back in the queue with one more attempt. */
export async function retryTask(taskId: string): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE public.agent_tasks
    SET status = 'queued', run_after = now(), finished_at = NULL, trigger = trigger,
        max_attempts = least(10, greatest(max_attempts, attempts + 1))
    WHERE id = ${taskId}::uuid AND status IN ('dead', 'failed', 'cancelled')`
  return count > 0
}

export async function listApprovals(status: 'pending' | 'all' = 'pending', limit = 100) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT a.id, a.task_id, a.agent_key, a.company_id, c.name AS company_name, a.tool, a.permission, a.summary,
           a.status, a.requested_at, a.expires_at, a.decided_by, a.decided_via, a.decision_reason, a.decided_at
    FROM public.agent_approvals a LEFT JOIN public.companies c ON c.id = a.company_id
    WHERE (${status} = 'all' OR a.status = 'pending')
    ORDER BY a.requested_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}`
}

export async function costSummary(days = 30) {
  const d = Math.min(Math.max(days, 1), 180)
  const [byDay, byAgent, byModel, byCompany] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT date_trunc('day', started_at)::date AS day, sum(cost_usd) AS cost, sum(tokens_in) AS tin, sum(tokens_out) AS tout, count(*) AS runs
      FROM public.agent_runs WHERE started_at > now() - make_interval(days => ${d}::int)
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT agent_key, sum(cost_usd) AS cost, sum(tokens_in) AS tin, sum(tokens_out) AS tout, count(*) AS runs, sum(llm_calls) AS llm_calls
      FROM public.agent_runs WHERE started_at > now() - make_interval(days => ${d}::int)
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT coalesce(model, '—') AS model, sum(cost_usd) AS cost, sum(tokens_in) AS tin, sum(tokens_out) AS tout, count(*) AS runs
      FROM public.agent_runs WHERE started_at > now() - make_interval(days => ${d}::int) AND llm_calls > 0
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT r.company_id, c.name AS company_name, sum(r.cost_usd) AS cost, count(*) AS runs
      FROM public.agent_runs r LEFT JOIN public.companies c ON c.id = r.company_id
      WHERE r.started_at > now() - make_interval(days => ${d}::int) AND r.company_id IS NOT NULL
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`,
  ])
  const num = (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' || v instanceof Prisma.Decimal ? Number(v) : v])))
  return { days: d, byDay: num(byDay), byAgent: num(byAgent), byModel: num(byModel), byCompany: num(byCompany) }
}

export async function listPlatformEvents(f: { name?: string | null; companyId?: string | null; limit?: number }) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, name, company_id, subject_type, subject_id, actor, payload, dispatched_at, dispatch_error, created_at
    FROM public.platform_events
    WHERE (${f.name ?? null}::text IS NULL OR name = ${f.name ?? null})
      AND (${f.companyId ?? null}::text IS NULL OR company_id = ${f.companyId ?? null})
    ORDER BY id DESC LIMIT ${Math.min(Math.max(f.limit ?? 100, 1), 500)}`
  return rows.map((r) => ({ ...r, id: n(r.id) }))
}

export async function staffFeed(f: { limit?: number; minLevel?: string | null } = {}) {
  const levels = f.minLevel === 'WARNING' ? ['WARNING', 'CRITICAL', 'APPROVAL_REQUIRED']
    : f.minLevel === 'CRITICAL' ? ['CRITICAL', 'APPROVAL_REQUIRED']
    : ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL', 'APPROVAL_REQUIRED']
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT e.id, e.level, e.type, e.title, e.body, e.company_id, c.name AS company_name, e.entity_type, e.entity_id,
           e.approval_id, e.agent_key, e.created_at,
           (SELECT count(*) FROM public.notification_deliveries d WHERE d.event_id = e.id AND d.status = 'sent') AS sent,
           (SELECT count(*) FROM public.notification_deliveries d WHERE d.event_id = e.id AND d.status = 'failed') AS failed
    FROM public.notification_events e LEFT JOIN public.companies c ON c.id = e.company_id
    WHERE e.audience = 'staff' AND e.level = ANY (${levels}::text[])
    ORDER BY e.created_at DESC LIMIT ${Math.min(Math.max(f.limit ?? 50, 1), 200)}`
  return rows.map((r) => ({ ...r, sent: n(r.sent), failed: n(r.failed) }))
}

