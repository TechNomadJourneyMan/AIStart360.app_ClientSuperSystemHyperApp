/**
 * lib/admin/staff-actions.ts — staff mutations shared by the GIGA API routes
 * and the admin Telegram bot (lib/telegram/bots/admin).
 *
 * The CALLER authorises (requireGiga in a route, the bot's rbac check for a
 * linked staff member — the same permission either way) and passes an
 * `audit` function bound to its actor and request. Each action writes the
 * audit entry BEFORE the change where the route always did (`required: true`:
 * no journal, no change) and returns a typed result the route maps to the
 * HTTP status it always returned.
 */
import type { AuditEntry } from '@/lib/admin/audit'
import { listAgentOverviews, cancelTask, retryTask, updateAgentConfig, type ConfigPatch } from '@/lib/agents/admin'
import { enqueueAgentTask, kickTask } from '@/lib/agents/queue'
import { getAgent } from '@/lib/agents/registry'
import { prisma } from '@/lib/db'
import { STAGE_LABELS, isDiagnosticStage } from '@/lib/diagnostics/pipeline'
import { getReportVersion, publishReportVersion, retireReportVersion, type TransitionResult } from '@/lib/reports/versions'
import { reviewItem, reviewItemCompany, type ReviewKind, type ReviewResult } from '@/lib/reports/review'

export type AuditWriter = (entry: AuditEntry, opts?: { required?: boolean }) => Promise<boolean>

type Fail<C extends string> = { ok: false; code: C; error: string }

// ─── Agents ──────────────────────────────────────────────────────────────────

export type RunAgentResult = { ok: true; taskId: string } | Fail<'not_found' | 'bad_request' | 'conflict'>

/** Manual run of an agent (GIGA «Запустить», bot «Запустить», «Запустить диагностику»). */
export async function runAgentManually(args: {
  key: string
  companyId?: string | null
  input?: Record<string, unknown>
  actorId: string
  audit: AuditWriter
}): Promise<RunAgentResult> {
  const def = getAgent(args.key)
  if (!def) return { ok: false, code: 'not_found', error: 'Агент не найден' }
  // A pipeline stage needs a diagnostic session (it would fail with NO_SESSION):
  // the orchestrator (`diagnostic_orchestrator`) opens one and runs the stages.
  if (isDiagnosticStage(def.key)) {
    return {
      ok: false,
      code: 'bad_request',
      error: `Этап «${STAGE_LABELS[def.key]}» запускается только внутри диагностики компании. Запустите диагностику компании — все этапы пройдут по порядку.`,
    }
  }
  const companyId = args.companyId ?? undefined
  if (def.scope === 'company') {
    if (!companyId) return { ok: false, code: 'bad_request', error: 'Выберите компанию' }
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.companies WHERE id = ${companyId}`
    if (!rows[0]) return { ok: false, code: 'not_found', error: 'Компания не найдена' }
  }
  const inputCheck = def.inputSchema.safeParse(args.input ?? {})
  if (!inputCheck.success) return { ok: false, code: 'bad_request', error: 'Неверные входные данные агента' }

  await args.audit({
    action: 'agent.run.manual', entityType: 'agent', entityId: def.key,
    newValue: { companyId: companyId ?? null, input: args.input ?? {} },
  }, { required: true })
  try {
    const task = await enqueueAgentTask({
      agentKey: def.key,
      companyId: def.scope === 'company' ? companyId! : null,
      trigger: 'manual',
      requestedBy: args.actorId,
      input: args.input ?? {},
      priority: 3,
    })
    return { ok: true, taskId: task.id }
  } catch (err) {
    const msg = err instanceof Error && /disabled/.test(err.message) ? 'Агент выключен' : 'Не удалось поставить задачу'
    return { ok: false, code: 'conflict', error: msg }
  }
}

export type TaskActionResult = { ok: true } | Fail<'conflict'>

/** Cancel or retry an agent task (audit first, as the route always did). */
export async function agentTaskAction(args: {
  taskId: string
  action: 'cancel' | 'retry'
  actorId: string
  audit: AuditWriter
}): Promise<TaskActionResult> {
  await args.audit({ action: `agent.task.${args.action}`, entityType: 'agent_task', entityId: args.taskId }, { required: true })
  if (args.action === 'cancel') {
    return (await cancelTask(args.taskId, args.actorId))
      ? { ok: true }
      : { ok: false, code: 'conflict', error: 'Задачу нельзя отменить в текущем статусе' }
  }
  if (!(await retryTask(args.taskId))) {
    return { ok: false, code: 'conflict', error: 'Повторить можно только завершившуюся неуспешно задачу' }
  }
  kickTask(args.taskId)
  return { ok: true }
}

const CONFIG_ERRORS: Record<string, string> = {
  unknown_agent: 'Агент не найден',
  invalid_cron: 'Неверное расписание (5 полей cron, UTC)',
  schedule_only_for_platform_agents: 'Расписание доступно только платформенным агентам',
}

export type ConfigResult = { ok: true } | Fail<'not_found' | 'bad_request'>

/** Agent config change (enable/disable, model, schedule, budgets) with the before/after audit. */
export async function updateAgentConfigAudited(args: {
  key: string
  patch: ConfigPatch
  actorId: string
  audit: AuditWriter
}): Promise<ConfigResult> {
  const before = (await listAgentOverviews()).find((a) => a.key === args.key)
  await args.audit({
    action: 'agent.config.update',
    entityType: 'agent',
    entityId: args.key,
    oldValue: before ? { enabled: before.enabled, tier: before.tier, model: before.model, cron: before.triggers.cron, limits: before.limits } : null,
    newValue: args.patch,
  }, { required: true })
  const res = await updateAgentConfig(args.key, args.patch, args.actorId)
  if (!res.ok) return { ok: false, code: res.error === 'unknown_agent' ? 'not_found' : 'bad_request', error: CONFIG_ERRORS[res.error] ?? res.error }
  return { ok: true }
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export type ReportAction = 'publish' | 'reject' | 'withdraw'

const TARGET: Record<ReportAction, string> = { publish: 'published', reject: 'superseded', withdraw: 'superseded' }
export const REPORT_WRONG_STATUS: Record<ReportAction, string> = {
  publish: 'Опубликовать можно только версию в статусе «Готов к проверке»',
  reject: 'Отклонить можно только неопубликованную версию',
  withdraw: 'Отозвать можно только опубликованную версию',
}

export type ReportTransitionOutcome =
  | { ok: true; status: string; superseded: string[]; companyId: string; reportType: string; version: number; title: string }
  | { ok: false; code: 'not_found' | 'audit_unavailable' | 'wrong_status'; status?: string | null }
  | { ok: false; code: 'db_load' | 'db_write'; err: { message?: string; code?: string } }

/**
 * Publish / reject / withdraw a report version. The audit entry is written
 * first; without it nothing changes. Experts are told about a publication.
 */
export async function transitionReportVersion(args: {
  id: string
  action: ReportAction
  reason: string | null
  actorId: string
  audit: AuditWriter
}): Promise<ReportTransitionOutcome> {
  let current
  try {
    current = await getReportVersion(args.id)
  } catch (err) {
    return { ok: false, code: 'db_load', err: err as { message?: string; code?: string } }
  }
  if (!current) return { ok: false, code: 'not_found' }

  try {
    await args.audit({
      action: `report.${args.action}`,
      entityType: 'report_version',
      entityId: args.id,
      oldValue: { status: current.status },
      newValue: { status: TARGET[args.action], reason: args.reason },
      metadata: { company_id: current.company_id, report_type: current.report_type, version: current.version, data_hash: current.data_hash },
    }, { required: true })
  } catch {
    return { ok: false, code: 'audit_unavailable' }
  }

  let res: TransitionResult
  try {
    res = args.action === 'publish'
      ? await publishReportVersion(args.id, args.actorId)
      : await retireReportVersion(args.id, args.action, args.actorId, args.reason ?? '')
  } catch (err) {
    return { ok: false, code: 'db_write', err: err as { message?: string; code?: string } }
  }
  if (!res.ok) return res.reason === 'not_found' ? { ok: false, code: 'not_found' } : { ok: false, code: 'wrong_status', status: res.status ?? null }

  if (args.action === 'publish') {
    void import('@/lib/telegram/bots/expert/notify')
      .then((m) => m.notifyExpertsSafely({
        kind: 'report.published',
        dedupeKey: `report.published:${args.id}`,
        companyId: current.company_id,
        lines: [`${current.title}`, `Версия ${current.version}`],
        reportId: args.id,
      }))
      .catch(() => {})
  }
  return {
    ok: true, status: res.status, superseded: res.superseded,
    companyId: current.company_id, reportType: current.report_type, version: current.version, title: current.title,
  }
}

// ─── AI review ───────────────────────────────────────────────────────────────

export type ReviewOutcome =
  | { ok: true; item: Extract<ReviewResult, { ok: true }> }
  | { ok: false; code: 'not_found' | 'already_reviewed' | 'audit_unavailable' }
  | { ok: false; code: 'db_load' | 'db_write'; err: { message?: string; code?: string } }

/** Show an AI hypothesis / model recommendation to the client, or dismiss it with a reason. */
export async function reviewAiItem(args: {
  kind: ReviewKind
  id: string
  decision: 'approve' | 'dismiss'
  reason: string | null
  actorId: string
  audit: AuditWriter
}): Promise<ReviewOutcome> {
  let target
  try {
    target = await reviewItemCompany(args.kind, args.id)
  } catch (err) {
    return { ok: false, code: 'db_load', err: err as { message?: string; code?: string } }
  }
  if (!target) return { ok: false, code: 'not_found' }

  try {
    await args.audit({
      action: `ai_review.${args.kind}.${args.decision}`,
      entityType: args.kind === 'finding' ? 'diagnostic_finding' : 'diagnostic_recommendation',
      entityId: args.id,
      newValue: { decision: args.decision, reason: args.reason },
      metadata: { company_id: target.company_id, title: target.title.slice(0, 300) },
    }, { required: true })
  } catch {
    return { ok: false, code: 'audit_unavailable' }
  }

  let res: ReviewResult
  try {
    res = await reviewItem({ kind: args.kind, id: args.id, decision: args.decision, actorId: args.actorId })
  } catch (err) {
    return { ok: false, code: 'db_write', err: err as { message?: string; code?: string } }
  }
  if (!res.ok) return { ok: false, code: res.reason }
  return { ok: true, item: res }
}
