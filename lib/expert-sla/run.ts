/**
 * lib/expert-sla/run.ts — один проход часов SLA экспертов (Inngest cron каждые
 * 5 минут, lib/functions/expert-sla.ts).
 *
 *   1. expert_sla_sync (миграция 145): закрыть задачи с готовым ответом,
 *      отметить реакции, перенести переназначенные кейсы, открыть задачи для
 *      новой работы (с исполнителем, если он уже есть у кейса или у клиента).
 *   2. Новые задачи без исполнителя: при «Назначать автоматически» —
 *      наименее загруженный эксперт (lib/expert-sla/assign.ts); иначе — общая
 *      очередь и уведомление SuperExpert. План Точки Б — очередь одобрения
 *      Admin / Super Admin (их уже уведомляет lib/point-b/plan/notify.ts).
 *   3. expert_sla_claim('breached') и затем ('escalated'): каждая задача
 *      достаётся ровно одному проходу — повторный запуск или ретрай не шлют
 *      дублей. Просрочка закрывает и эскалацию: бэклог получает одно сообщение.
 *
 * Бюджет ≤ 30 с (правило ≤ 45 с на единицу фоновой работы), без LLM, без
 * долгих транзакций: каждый шаг — один короткий запрос.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimUnassignedClient, isSlaWorker, loadExpertCandidates, pickLeastLoaded, type Candidate } from './assign'
import { createDefaultNotifier, type SlaNotifier, type TaskBrief } from './notify'
import { DEFAULT_EXPERT_SLA, TASK_COLUMNS, isExpertWorkSource, type ExpertSlaConfig } from './policy'

export const SLA_RUN_BUDGET_MS = 30_000
export const SLA_SYNC_LIMIT = 200
export const SLA_CLAIM_LIMIT = 50

export { TASK_COLUMNS }

export interface SlaRunDeps {
  sb: Pick<SupabaseClient, 'from' | 'rpc'>
  now?: Date
  budgetMs?: number
  limit?: number
  config?: () => Promise<ExpertSlaConfig>
  notifier?: SlaNotifier
  /** Монотонные часы для бюджета (тесты). */
  clock?: () => number
}

export interface SlaRunReport {
  enabled: boolean
  closed: number
  reacted: number
  reassigned: number
  created: number
  autoAssigned: number
  queued: number
  escalated: number
  breached: number
  budgetExhausted: boolean
}

interface SyncRow { r_task: string; r_change: string; r_source: string; r_client: string; r_assignee: string | null; r_via: string | null }
type TaskRow = TaskBrief & { source_id: string; assigned_via: string | null }

async function defaultConfig(): Promise<ExpertSlaConfig> {
  const { getSetting } = await import('@/lib/settings/store')
  try {
    return await getSetting('expert_sla')
  } catch {
    return DEFAULT_EXPERT_SLA
  }
}

export async function runExpertSla(deps: SlaRunDeps): Promise<SlaRunReport> {
  const { sb } = deps
  const now = deps.now ?? new Date()
  const clock = deps.clock ?? Date.now
  const started = clock()
  const budget = deps.budgetMs ?? SLA_RUN_BUDGET_MS
  const over = () => clock() - started > budget
  const report: SlaRunReport = {
    enabled: true, closed: 0, reacted: 0, reassigned: 0, created: 0, autoAssigned: 0, queued: 0, escalated: 0, breached: 0, budgetExhausted: false,
  }

  const cfg = await (deps.config ?? defaultConfig)()
  if (!cfg.enabled) return { ...report, enabled: false }
  const notifier = deps.notifier ?? createDefaultNotifier({ sb })

  // 1. Sync.
  const sync = await sb.rpc('expert_sla_sync', {
    p_now: now.toISOString(),
    p_reaction_hours: cfg.reaction_hours,
    p_answer_hours: cfg.answer_hours,
    p_limit: deps.limit ?? SLA_SYNC_LIMIT,
  })
  if (sync.error) throw new Error(`expert_sla_sync: ${sync.error.message?.slice(0, 200)}`)
  const changes = (sync.data ?? []) as SyncRow[]
  for (const c of changes) {
    if (c.r_change === 'closed') report.closed++
    else if (c.r_change === 'reacted') report.reacted++
    else if (c.r_change === 'reassigned') report.reassigned++
    else if (c.r_change === 'new') report.created++
  }

  // 2. New tasks: assign or queue.
  const newIds = changes.filter((c) => c.r_change === 'new').map((c) => c.r_task)
  const assigned: TaskBrief[] = []
  const queued: TaskBrief[] = []
  if (newIds.length) {
    const { data, error } = await sb.from('expert_sla_tasks').select(TASK_COLUMNS).in('id', newIds)
    if (error) throw new Error(`expert_sla_tasks read: ${error.message?.slice(0, 200)}`)
    let candidates: Candidate[] | null = null
    for (const task of ((data ?? []) as TaskRow[]).sort((a, b) => a.received_at.localeCompare(b.received_at))) {
      if (task.assignee_id) {
        // A case that already had its assignee was announced to him when it was created / assigned.
        if (!(task.source === 'case' && task.assigned_via === 'source')) assigned.push(task)
        continue
      }
      if (!isExpertWorkSource(task.source)) continue // plan approval: Admin / Super Admin queue
      if (!cfg.auto_assign || over()) { queued.push(task); continue }
      candidates ??= await loadExpertCandidates(sb).catch((err: unknown) => {
        console.error('[expert-sla] candidates', err instanceof Error ? err.message.slice(0, 160) : err)
        return [] as Candidate[]
      })
      const pick = pickLeastLoaded(candidates)
      if (!pick) { queued.push(task); continue }
      const holder = await claimUnassignedClient(sb, task.client_id, pick.id, now)
      const target = holder === pick.id ? pick.id : holder && (await isSlaWorker(sb, holder)) ? holder : null
      if (!target) { queued.push(task); continue }
      const via = target === pick.id ? 'auto' : 'client'
      const at = now.toISOString()
      const upd = await sb.from('expert_sla_tasks')
        .update({ assignee_id: target, assigned_at: at, assigned_via: via })
        .eq('id', task.id).is('assignee_id', null).select('id')
      if (upd.error || !(upd.data as unknown[] | null)?.length) { queued.push(task); continue }
      if (task.source === 'case') {
        // Keep «Эскалации» in step: the case gets the same assignee when it had none.
        await sb.from('expert_cases').update({ assignee_id: target, assigned_to: target })
          .eq('id', task.source_id).is('assignee_id', null)
      }
      const c = candidates.find((x) => x.id === target)
      if (c) {
        c.openTasks++
        c.lastAssignedAt = at
        if (via === 'auto' && holder === pick.id) c.clients++
      }
      report.autoAssigned++
      assigned.push({ ...task, assignee_id: target })
    }
  }
  report.queued = queued.length
  for (const t of assigned) await notifier.assigned(t)
  await notifier.queued(queued)

  // 3. Thresholds: the breach first (it closes the escalation too), then the 24-hour escalation.
  for (const stage of ['breached', 'escalated'] as const) {
    if (over()) { report.budgetExhausted = true; break }
    const claim = await sb.rpc('expert_sla_claim', { p_stage: stage, p_now: now.toISOString(), p_limit: SLA_CLAIM_LIMIT })
    if (claim.error) throw new Error(`expert_sla_claim(${stage}): ${claim.error.message?.slice(0, 200)}`)
    const tasks = (claim.data ?? []) as TaskBrief[]
    report[stage] = tasks.length
    await notifier.threshold(stage, tasks)
  }
  if (over()) report.budgetExhausted = true
  return report
}
