/**
 * lib/expert-sla/run.ts — один проход часов SLA экспертов (крон портала каждые
 * 5 минут, /api/cron/expert-sla, lib/cron/schedule.ts). Шаги НЕЗАВИСИМЫ: сбой одного не
 * останавливает следующие (п. 9 ревью).
 *
 *   1. expert_sla_sync (145/146): старт часов на первом проходе, закрыть
 *      выполненное (с ответом или без), перенести переназначенные кейсы,
 *      выровнять задачи по ответственному клиента, отметить реакции, открыть
 *      задачи для новой работы. Сбой — в журнал и одно уведомление в час.
 *   1б. План Точки Б (152): скан «клиент ждёт план» (lib/point-b/plan/waiting.ts,
 *      модель на каждого кандидата — свой бюджет ≤ 10 с и лимит) → RPC
 *      expert_sla_plan_prep: открыть plan_prep ждущим, закрыть без ответа тем,
 *      кто больше не ждёт и над чьим планом никто не работает. Сбой скана не
 *      останавливает остальные шаги.
 *   2. Авто-назначение (настройка «Назначать автоматически»): открытые
 *      экспертные задачи без исполнителя, до 100 за проход, старейшие первыми.
 *      Только обычным клиентам без ответственного (п. 4 ревью) — наименее
 *      загруженному эксперту, с записью в журнал аудита. Не дошёл бюджет —
 *      задача остаётся и берётся следующим проходом (не уходит в «очередь»).
 *   3. expert_sla_claim('breached') и ('escalated') — захват порогов в базе,
 *      каждая задача ровно одному проходу.
 *   4. Доставка (outbox, миграция 146): просрочки → эскалации → новые задачи
 *      исполнителям (одно сообщение на исполнителя) → очередь SuperExpert →
 *      план Точки Б без исполнителя — Admin / Super Admin (152).
 *      «Уведомлено» отмечается только после успешной доставки; неудача
 *      считает попытку (до 5) и повторяется следующим проходом.
 *
 * Бюджет ≤ 30 с (правило ≤ 45 с), проверяется в каждом цикле; без LLM, без
 * долгих транзакций; чтения по спискам id — чанками по 100.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEntry } from '@/lib/admin/audit'
import {
  claimUnassignedClient, isSlaWorker, loadAutoAssignTargets, loadExpertCandidates, pickLeastLoaded, type Candidate,
} from './assign'
import { BATCH, createDefaultNotifier, type Delivery, type SlaNotifier, type TaskBrief } from './notify'
import {
  DEFAULT_EXPERT_SLA, EXPERT_WORK_SOURCES, MAX_NOTIFY_ATTEMPTS, TASK_COLUMNS, chunked, type ExpertSlaConfig,
} from './policy'
import type { WaitingScan, WaitingScanOptions } from '@/lib/point-b/plan/waiting'

export { TASK_COLUMNS }

export const SLA_RUN_BUDGET_MS = 30_000
export const SLA_SYNC_LIMIT = 200
export const SLA_CLAIM_LIMIT = 50
export const AUTO_ASSIGN_BATCH = 100
export const DELIVERY_BATCH = 200
export const SYSTEM_AUDIT_ACTOR = { id: 'system:expert-sla', kind: 'system' as const }
/** Скан «клиент ждёт план» (152): не дольше и не больше этого за проход (модель на каждого кандидата). */
export const PLAN_PREP_BUDGET_MS = 10_000
export const PLAN_PREP_LIMIT = 30
/** Сколько бюджета прохода оставить порогам и доставке после скана. */
const PLAN_PREP_RESERVE_MS = 10_000

export type PlanPrepScan = (sb: SlaRunDeps['sb'], opts: Pick<WaitingScanOptions, 'now' | 'limit' | 'budgetMs'>) => Promise<WaitingScan>

export interface SlaRunDeps {
  sb: Pick<SupabaseClient, 'from' | 'rpc'>
  now?: Date
  budgetMs?: number
  limit?: number
  config?: () => Promise<ExpertSlaConfig>
  notifier?: SlaNotifier
  /** Журнал аудита (по умолчанию recordAdminAction от имени системы). */
  audit?: (entry: AuditEntry) => Promise<boolean>
  /** Монотонные часы для бюджета (тесты). */
  clock?: () => number
  /** Скан «клиент ждёт план» (по умолчанию listClientsWaitingForPlan). */
  planPrepScan?: PlanPrepScan
}

export interface SlaRunReport {
  enabled: boolean
  syncError: string | null
  closed: number
  reacted: number
  reassigned: number
  unassigned: number
  created: number
  autoAssigned: number
  /** Задачи без исполнителя, о которых сообщили SuperExpert в этот проход. */
  queued: number
  escalated: number
  breached: number
  delivered: { assigned: number; queued: number; escalated: number; breached: number }
  failedDeliveries: number
  budgetExhausted: boolean
  /** 152: скан «клиент ждёт план» этого прохода. */
  planPrep: { checked: number; waiting: number; opened: number; dropped: number; truncated: boolean; error: string | null; skipped: boolean }
}

interface SyncRow { r_task: string; r_change: string; r_source: string; r_client: string; r_assignee: string | null; r_via: string | null }
type TaskRow = TaskBrief & {
  source_id: string
  assigned_via: string | null
  queue_notified_at: string | null
  notify_attempts?: number
  info_attempts?: number
}

async function defaultConfig(): Promise<ExpertSlaConfig> {
  const { getSetting } = await import('@/lib/settings/store')
  try {
    return await getSetting('expert_sla')
  } catch {
    return DEFAULT_EXPERT_SLA
  }
}

const defaultPlanPrepScan: PlanPrepScan = async (sb, opts) => {
  const { listClientsWaitingForPlan } = await import('@/lib/point-b/plan/waiting')
  return listClientsWaitingForPlan(sb as SupabaseClient, opts)
}

async function defaultAudit(entry: AuditEntry): Promise<boolean> {
  const { recordAdminAction } = await import('@/lib/admin/audit')
  return recordAdminAction(SYSTEM_AUDIT_ACTOR, entry)
}

function msg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

/** ≤ BATCH задач — по одной; больше — одна сводка. */
export function deliveryGroups<T>(rows: T[]): T[][] {
  return rows.length > BATCH ? [rows] : rows.map((r) => [r])
}

export async function runExpertSla(deps: SlaRunDeps): Promise<SlaRunReport> {
  const { sb } = deps
  const now = deps.now ?? new Date()
  const at = now.toISOString()
  const clock = deps.clock ?? Date.now
  const started = clock()
  const budget = deps.budgetMs ?? SLA_RUN_BUDGET_MS
  const report: SlaRunReport = {
    enabled: true, syncError: null, closed: 0, reacted: 0, reassigned: 0, unassigned: 0, created: 0, autoAssigned: 0, queued: 0,
    escalated: 0, breached: 0, delivered: { assigned: 0, queued: 0, escalated: 0, breached: 0 }, failedDeliveries: 0, budgetExhausted: false,
    planPrep: { checked: 0, waiting: 0, opened: 0, dropped: 0, truncated: false, error: null, skipped: true },
  }
  const over = () => {
    if (clock() - started > budget) report.budgetExhausted = true
    return report.budgetExhausted
  }

  const cfg = await (deps.config ?? defaultConfig)()
  if (!cfg.enabled) return { ...report, enabled: false }
  const notifier = deps.notifier ?? createDefaultNotifier({ sb })
  const audit = deps.audit ?? defaultAudit

  // ── 1. Sync (its failure does not stop the thresholds of open tasks) ──
  try {
    const sync = await sb.rpc('expert_sla_sync', {
      p_now: at, p_reaction_hours: cfg.reaction_hours, p_answer_hours: cfg.answer_hours, p_limit: deps.limit ?? SLA_SYNC_LIMIT,
    })
    if (sync.error) throw new Error(`expert_sla_sync: ${sync.error.message?.slice(0, 200)}`)
    for (const c of (sync.data ?? []) as SyncRow[]) {
      if (c.r_change === 'closed') report.closed++
      else if (c.r_change === 'reacted') report.reacted++
      else if (c.r_change === 'reassigned') report.reassigned++
      else if (c.r_change === 'unassigned') report.unassigned++
      else if (c.r_change === 'new') report.created++
    }
  } catch (err) {
    report.syncError = msg(err)
    console.error('[expert-sla] sync failed:', report.syncError)
    await notifier.syncFailed(report.syncError, now)
  }

  // ── 1b. Point B: who waits for a plan (152). Its own budget; a failure stops nothing else ──
  const scanBudget = budget - PLAN_PREP_RESERVE_MS >= 1_000
    ? Math.min(PLAN_PREP_BUDGET_MS, budget - (clock() - started) - PLAN_PREP_RESERVE_MS)
    : 0
  if (scanBudget >= 1_000 && !over()) {
    report.planPrep.skipped = false
    try {
      await planPrepStep(scanBudget)
    } catch (err) {
      report.planPrep.error = msg(err)
      console.error('[expert-sla] plan_prep scan failed:', report.planPrep.error)
    }
  }

  // ── 2. Auto-assignment; tasks with nobody to go to → the queue news ──
  let queueNews: TaskRow[] = []
  if (!over()) {
    try {
      queueNews = await autoAssign()
    } catch (err) {
      console.error('[expert-sla] auto-assign failed:', msg(err))
    }
  }

  // ── 3. Thresholds (claimed in the database, once per task) ──
  for (const stage of ['breached', 'escalated'] as const) {
    if (over()) break
    try {
      const claim = await sb.rpc('expert_sla_claim', { p_stage: stage, p_now: at, p_limit: SLA_CLAIM_LIMIT })
      if (claim.error) throw new Error(claim.error.message?.slice(0, 200))
      report[stage] = ((claim.data ?? []) as unknown[]).length
    } catch (err) {
      console.error(`[expert-sla] claim ${stage} failed:`, msg(err))
    }
  }

  // ── 4. Deliveries: the outbox, most important first ──
  for (const stage of ['breached', 'escalated'] as const) {
    if (over()) break
    const pending = await pendingRows(stage)
    for (const group of deliveryGroups(pending)) {
      if (over()) break
      await settle(stage, group, await notifier.threshold(stage, group))
    }
  }

  if (!over()) {
    const pending = await pendingRows('assigned')
    const byAssignee = new Map<string, TaskRow[]>()
    for (const t of pending) byAssignee.set(t.assignee_id!, [...(byAssignee.get(t.assignee_id!) ?? []), t])
    for (const [assignee, tasks] of Array.from(byAssignee.entries())) {
      if (over()) break
      await settle('assigned', tasks, await notifier.assigned(assignee, tasks), assignee)
    }
  }

  const queue = queueNews.filter((t) => !t.queue_notified_at && (t.info_attempts ?? 0) < MAX_NOTIFY_ATTEMPTS)
  report.queued = queue.length
  for (const group of deliveryGroups(queue)) {
    if (over()) break
    await settle('queued', group, await notifier.queued(group))
  }

  // 152: a Point B plan waits for Admin / Super Admin (never auto-assigned to an expert).
  if (!over()) {
    const plans = await pendingPlanQueue()
    report.queued += plans.length
    for (const group of deliveryGroups(plans)) {
      if (over()) break
      await settle('queued', group, await notifier.queued(group, 'admins'))
    }
  }

  over()
  return report

  // ── helpers (closures over sb / report) ──

  /** Undelivered notifications of one kind (open tasks, under the attempt cap). */
  async function pendingRows(kind: 'breached' | 'escalated' | 'assigned'): Promise<TaskRow[]> {
    try {
      let q = sb.from('expert_sla_tasks').select(TASK_COLUMNS).is('closed_at', null)
      if (kind === 'breached') q = q.not('breached_at', 'is', null).is('breach_notified_at', null).lt('notify_attempts', MAX_NOTIFY_ATTEMPTS)
      else if (kind === 'escalated') q = q.not('escalated_at', 'is', null).is('escalation_notified_at', null).lt('notify_attempts', MAX_NOTIFY_ATTEMPTS)
      else q = q.not('assignee_id', 'is', null).is('assign_notified_at', null).lt('info_attempts', MAX_NOTIFY_ATTEMPTS)
      const order = kind === 'breached' ? 'breached_at' : kind === 'escalated' ? 'escalated_at' : 'received_at'
      const { data, error } = await q.order(order, { ascending: true }).limit(DELIVERY_BATCH)
      if (error) throw new Error(error.message?.slice(0, 200))
      return (data ?? []) as unknown as TaskRow[]
    } catch (err) {
      console.error('[expert-sla] outbox read failed:', msg(err))
      return []
    }
  }

  /** The scan «клиент ждёт план» → open plan_prep for the waiting, close for those who no longer wait (152). */
  async function planPrepStep(scanBudget: number): Promise<void> {
    const scan = await (deps.planPrepScan ?? defaultPlanPrepScan)(sb, { now, limit: PLAN_PREP_LIMIT, budgetMs: scanBudget })
    report.planPrep.checked = scan.checked
    report.planPrep.waiting = scan.waiting.length
    report.planPrep.truncated = scan.truncated
    const candidates = new Set(scan.candidates)
    const dropped: Array<{ company: string; reason: string }> = scan.dropped.map((d) => ({ company: d.companyId, reason: d.reason }))
    // An open task whose company is no longer a candidate: the goal is gone (or a version / the owner changed —
    // the database keeps a task whose plan is in work, and closes an approved / ownerless one itself).
    const { data: open, error: openErr } = await sb.from('expert_sla_tasks').select('source_id')
      .eq('source', 'plan_prep').is('closed_at', null).limit(1000)
    if (openErr) throw new Error(`open plan_prep: ${openErr.message?.slice(0, 200)}`)
    for (const t of (open ?? []) as Array<{ source_id: string }>) {
      if (!candidates.has(t.source_id)) dropped.push({ company: t.source_id, reason: 'no_goal' })
    }
    if (!scan.waiting.length && !dropped.length) return // nothing to open or drop: no round trip
    const res = await sb.rpc('expert_sla_plan_prep', {
      p_now: at, p_reaction_hours: cfg.reaction_hours, p_answer_hours: cfg.answer_hours,
      p_waiting: scan.waiting.map((w) => ({ company: w.companyId, client: w.userId })),
      p_dropped: dropped,
      p_limit: deps.limit ?? SLA_SYNC_LIMIT,
    })
    if (res.error) throw new Error(`expert_sla_plan_prep: ${res.error.message?.slice(0, 200)}`)
    for (const c of (res.data ?? []) as SyncRow[]) {
      if (c.r_change === 'new') { report.planPrep.opened++; report.created++ }
      else if (c.r_change === 'closed') { report.planPrep.dropped++; report.closed++ }
    }
  }

  /** Open plan_prep tasks nobody holds and nobody was told about (Admin / Super Admin). */
  async function pendingPlanQueue(): Promise<TaskRow[]> {
    try {
      const { data, error } = await sb.from('expert_sla_tasks').select(TASK_COLUMNS)
        .eq('source', 'plan_prep').is('closed_at', null).is('assignee_id', null).is('queue_notified_at', null)
        .lt('info_attempts', MAX_NOTIFY_ATTEMPTS)
        .order('received_at', { ascending: true }).limit(DELIVERY_BATCH)
      if (error) throw new Error(error.message?.slice(0, 200))
      return (data ?? []) as unknown as TaskRow[]
    } catch (err) {
      console.error('[expert-sla] plan queue read failed:', msg(err))
      return []
    }
  }

  async function settle(kind: 'assigned' | 'queued' | 'escalated' | 'breached', tasks: TaskRow[], res: Delivery, assignee?: string): Promise<void> {
    if (res.ok) report.delivered[kind] += tasks.length
    else report.failedDeliveries += tasks.length
    for (const part of chunked(tasks.map((t) => t.id))) {
      const mark = await sb.rpc('expert_sla_mark_notified', {
        p_ids: part, p_kind: kind, p_ok: res.ok, p_error: res.ok ? null : res.error, p_assignee: assignee ?? null, p_now: at,
      })
      if (mark.error) console.error(`[expert-sla] mark ${kind} failed:`, mark.error.message?.slice(0, 200))
    }
  }

  async function autoAssign(): Promise<TaskRow[]> {
    const { data, error } = await sb.from('expert_sla_tasks').select(TASK_COLUMNS)
      .is('closed_at', null).is('assignee_id', null).in('source', [...EXPERT_WORK_SOURCES])
      .order('received_at', { ascending: true }).limit(AUTO_ASSIGN_BATCH)
    if (error) throw new Error(`unassigned tasks: ${error.message?.slice(0, 200)}`)
    const tasks = (data ?? []) as TaskRow[]
    if (!tasks.length) return []
    if (!cfg.auto_assign) return tasks // all of them wait in the queue for SuperExpert

    const targets = await loadAutoAssignTargets(sb, tasks.map((t) => t.client_id))
    const queue: TaskRow[] = []
    const settledClients = new Set<string>()
    let candidates: Candidate[] | null = null
    for (const task of tasks) {
      if (over()) break // the rest is picked up by the next pass
      if (settledClients.has(task.client_id)) continue
      const target = targets.get(task.client_id)
      if (!target?.plain) { queue.push(task); continue } // staff / expert / not approved: a person decides
      if (target.responsible) {
        // A worker responsible gets it by the realign of the next sync; anybody else — the queue.
        if (!(await isSlaWorker(sb, target.responsible))) queue.push(task)
        continue
      }
      candidates ??= await loadExpertCandidates(sb)
      const pick = pickLeastLoaded(candidates)
      if (!pick) { queue.push(task); continue }
      const holder = await claimUnassignedClient(sb, task.client_id, pick.id, now)
      if (holder !== pick.id) continue // somebody was faster: the realign of the next pass follows him
      settledClients.add(task.client_id)
      await audit({
        action: 'user.assigned', entityType: 'user', entityId: task.client_id, targetUserId: task.client_id,
        oldValue: { assignee_id: null }, newValue: { assignee_id: pick.id },
        metadata: { via: 'expert_sla.auto_assign', taskId: task.id, source: task.source, rule: 'least_loaded' },
      }).catch((err: unknown) => { console.error('[expert-sla] audit failed:', msg(err)); return false })
      // Every open expert task of the client goes to him (the trigger of 146 did it already in the database).
      const { data: moved } = await sb.from('expert_sla_tasks')
        .update({ assignee_id: pick.id, assigned_at: at, assigned_via: 'auto' })
        .eq('client_id', task.client_id).is('closed_at', null).in('source', [...EXPERT_WORK_SOURCES])
        .or(`assignee_id.is.null,assignee_id.eq.${pick.id}`)
        .select('id')
      const n = (moved as unknown[] | null)?.length ?? 0
      // «Эскалации» in step: open cases of the client without an assignee.
      await sb.from('expert_cases').update({ assignee_id: pick.id, assigned_to: pick.id })
        .eq('user_id', task.client_id).in('status', ['new', 'in_progress']).is('assignee_id', null)
      pick.openTasks += Math.max(1, n)
      pick.clients++
      pick.lastAssignedAt = at
      report.autoAssigned += Math.max(1, n)
    }
    return queue
  }
}
