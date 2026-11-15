/**
 * lib/expert-sla/immediate.ts — «сразу» для ИИ-разбора Точки А (решение PO
 * «гибрид», R3-SLA): как только разбор сохранён (целиком или частично), задача
 * эксперта pa_ai_review открывается и о ней сообщают немедленно, не дожидаясь
 * прохода SLA (раз в 5 минут).
 *
 *   1. RPC expert_sla_open_ai_review(диагностика, …, p_claim, p_claim_queue)
 *      (миграция 152) открывает задачу ровно для этой строки diagnostics — по
 *      тем же правилам, что проход (исполнитель — ответственный клиента-эксперт,
 *      наследование часов). Объявление ЗАХВАТЫВАЕТСЯ при вставке
 *      (assign_notified_at / queue_notified_at = сейчас): outbox прохода такую
 *      задачу не видит, второго сообщения не будет.
 *   2. Есть исполнитель — ему одно сообщение (лента + экспертный бот). Нет и
 *      авто-назначение невозможно (выключено, экспертов нет, у клиента
 *      ответственный не эксперт, клиент — не обычный клиент) — сообщение в общую
 *      очередь SuperExpert (ключ ленты expert_sla.queued:<id> — тот же, что у
 *      прохода). Если авто-назначение возможно — очередь не захватывается:
 *      эксперта назначит проход (≤ 5 мин) и сообщит ему сам.
 *   3. Доставка не удалась — захват снимается и попытка считается
 *      (expert_sla_mark_notified ok=false): проход повторит.
 *
 * Никогда не бросает: сбой здесь не должен ломать сохранение разбора.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAutoAssignTargets, loadExpertCandidates } from './assign'
import { createDefaultNotifier, type Delivery, type SlaNotifier, type TaskBrief } from './notify'
import { DEFAULT_EXPERT_SLA, TASK_COLUMNS, type ExpertSlaConfig } from './policy'

type Sb = Pick<SupabaseClient, 'from' | 'rpc'>

export interface AiReviewNowDeps {
  sb: Sb
  diagnosticId: string
  now?: Date
  config?: () => Promise<ExpertSlaConfig>
  notifier?: SlaNotifier
}

export interface AiReviewNowResult {
  opened: boolean
  notified: 'assignee' | 'queue' | null
  /** Delivery failed — the pass retries it. */
  failed?: boolean
  error?: string
}

interface SyncRow { r_task: string; r_change: string; r_assignee: string | null }

async function defaultConfig(): Promise<ExpertSlaConfig> {
  const { getSetting } = await import('@/lib/settings/store')
  try {
    return await getSetting('expert_sla')
  } catch {
    return DEFAULT_EXPERT_SLA
  }
}

function msg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

/** Would the pass auto-assign this client's unassigned expert task (run.ts autoAssign)? */
async function autoAssignPossible(sb: Sb, clientId: string, cfg: ExpertSlaConfig): Promise<boolean> {
  if (!cfg.auto_assign) return false
  try {
    const target = (await loadAutoAssignTargets(sb, [clientId])).get(clientId)
    if (!target?.plain || target.responsible) return false
    return (await loadExpertCandidates(sb)).length > 0
  } catch {
    // Unknown: leave the queue to the pass (it decides with the same rule ≤ 5 min later).
    return true
  }
}

export async function announceAiReviewNow(deps: AiReviewNowDeps): Promise<AiReviewNowResult> {
  const { sb, diagnosticId } = deps
  const now = deps.now ?? new Date()
  const at = now.toISOString()
  try {
    const cfg = await (deps.config ?? defaultConfig)()
    if (!cfg.enabled) return { opened: false, notified: null }

    const { data: diag, error: dErr } = await sb.from('diagnostics').select('user_id').eq('id', diagnosticId).maybeSingle()
    if (dErr) console.error('[expert-sla/immediate] diagnostics read failed:', dErr.message?.slice(0, 120))
    if (dErr || !diag) return { opened: false, notified: null, error: dErr ? `diagnostics: ${dErr.message?.slice(0, 120)}` : undefined }
    const clientId = String((diag as { user_id: string }).user_id)
    const claimQueue = !(await autoAssignPossible(sb, clientId, cfg))

    const opened = await sb.rpc('expert_sla_open_ai_review', {
      p_diagnostic: diagnosticId, p_now: at, p_reaction_hours: cfg.reaction_hours, p_answer_hours: cfg.answer_hours,
      p_limit: 1, p_claim: true, p_claim_queue: claimQueue,
    })
    if (opened.error) {
      // Logged: on staging 2026-11-15 a grant error here was silent and the expert never got the task.
      console.error('[expert-sla/immediate] expert_sla_open_ai_review failed:', opened.error.code ?? '', opened.error.message?.slice(0, 200))
      return { opened: false, notified: null, error: `expert_sla_open_ai_review: ${opened.error.message?.slice(0, 200)}` }
    }
    const row = ((opened.data ?? []) as SyncRow[]).find((r) => r.r_change === 'new')
    if (!row) return { opened: false, notified: null }

    const { data: found } = await sb.from('expert_sla_tasks').select(TASK_COLUMNS).eq('id', row.r_task).maybeSingle()
    const task = found as (TaskBrief & { assign_notified_at: string | null; queue_notified_at: string | null }) | null
    if (!task) return { opened: true, notified: null }

    const notifier = deps.notifier ?? createDefaultNotifier({ sb })
    let kind: 'assigned' | 'queued' | null = null
    let res: Delivery | null = null
    if (task.assignee_id && task.assign_notified_at) {
      kind = 'assigned'
      res = await notifier.assigned(task.assignee_id, [task])
    } else if (!task.assignee_id && task.queue_notified_at) {
      kind = 'queued'
      res = await notifier.queued([task])
    }
    if (!kind || !res) return { opened: true, notified: null }
    if (res.ok) return { opened: true, notified: kind === 'assigned' ? 'assignee' : 'queue' }

    // Release the claim: the outbox of the pass delivers it (attempt counted, error kept).
    const column = kind === 'assigned' ? 'assign_notified_at' : 'queue_notified_at'
    await sb.from('expert_sla_tasks').update({ [column]: null }).eq('id', task.id).eq(column, kind === 'assigned' ? task.assign_notified_at : task.queue_notified_at)
    await sb.rpc('expert_sla_mark_notified', {
      p_ids: [task.id], p_kind: kind, p_ok: false, p_error: res.error, p_assignee: task.assignee_id ?? null, p_now: at,
    })
    return { opened: true, notified: null, failed: true, error: res.error }
  } catch (err) {
    console.error('[expert-sla/immediate] ai review announcement failed:', msg(err))
    return { opened: false, notified: null, error: msg(err) }
  }
}
