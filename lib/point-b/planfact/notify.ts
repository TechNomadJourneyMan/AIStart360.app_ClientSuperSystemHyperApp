/**
 * lib/point-b/planfact/notify.ts — who hears about the plan-fact (spec §13–§14). Never throws (a failure is logged:
 * the recompute / the reconciliation has already happened); every send is idempotent by its key.
 *
 *   notifyDeviation        the expert (assigned, else everyone with clients.review): the fact is behind the plan,
 *                          a draft revision is proposed (or one is already open); once per company and month
 *   remindReconciliation   the client: «внесите факт за месяц» through notifyClient — the client's own settings of the
 *                          category «Напоминания» decide the channels (in-app / email / Telegram); once per month
 *   reconciliationTask     the expert: a staff task «проверить сверку» about the client (staff_tasks), once per month
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyClient } from '@/lib/notifications/notify'
import { notifyStaff } from '@/lib/notifications/staff'
import { POINT_B_STAFF_PERMISSION, pointBStaffLink } from '../plan/notify'
import { HISTORY_HREF } from './insights'
import { periodLabel } from './kpis'

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The expert assigned to the client (user_assignments), or null. */
export async function assignedExpert(sb: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await sb.from('user_assignments').select('assignee_id').eq('user_id', userId).maybeSingle()
    return (data as { assignee_id?: string | null } | null)?.assignee_id ?? null
  } catch {
    return null
  }
}

export async function notifyDeviation(
  sb: SupabaseClient,
  input: { userId: string; companyId: string; period: string; reason: string; draftCreated: boolean; draftVersion: number | null },
): Promise<void> {
  try {
    const assignee = await assignedExpert(sb, input.userId)
    await notifyStaff({
      level: 'WARNING',
      type: 'point_b.plan_fact.deviation',
      title: 'Факт клиента отстаёт от плана «Точки Б»',
      lines: [
        `Месяц: ${periodLabel(input.period)}`,
        `Причина: ${input.reason}`,
        input.draftCreated
          ? `Создан черновик пересмотра плана (версия ${input.draftVersion ?? '—'}) — проверьте и отправьте на одобрение или закройте.`
          : 'У плана уже есть открытая версия — учтите отклонение в ней.',
      ],
      companyId: input.companyId,
      entityType: 'company',
      entityId: input.companyId,
      link: pointBStaffLink(input.userId),
      dedupeKey: `point_b.plan_fact.deviation:${input.companyId}:${input.period}`,
      audienceUserIds: assignee ? [assignee] : null,
      audiencePermission: POINT_B_STAFF_PERMISSION,
      skipCooldown: true,
    })
  } catch (err) {
    console.error('[point-b/planfact] deviation not notified', msg(err))
  }
}

export async function remindReconciliation(input: { userId: string; period: string; now: Date }): Promise<boolean> {
  try {
    const res = await notifyClient({
      userId: input.userId,
      category: 'reminders',
      event: 'pb_monthly_reconciliation',
      title: `Сверка плана за ${periodLabel(input.period)}`,
      body: `Внесите факт за ${periodLabel(input.period)}: выручку и другие ключевые показатели плана. Это займёт пару минут — мы сравним факт с планом и покажем, на курсе ли вы.`,
      ctaUrl: HISTORY_HREF,
      ctaLabel: 'Внести факт',
      dedupeKey: `pb_reconciliation:${input.userId}:${input.period}`,
      automated: { kind: 'pb_monthly_reconciliation', countsTowardCap: false },
      metadata: { period: input.period },
    }, input.now)
    return res.ok && !res.skipped
  } catch (err) {
    console.error('[point-b/planfact] reconciliation reminder failed', msg(err))
    return false
  }
}

export const reconciliationTaskTitle = (period: string): string => `Точка Б: проверить сверку за ${periodLabel(period)}`

/** A staff task for the assigned expert (no assignee → the task is not created: nobody would do it). */
export async function reconciliationTask(sb: SupabaseClient, input: { userId: string; period: string; dueAt: string }): Promise<'created' | 'exists' | 'no_assignee' | 'failed'> {
  try {
    const assignee = await assignedExpert(sb, input.userId)
    if (!assignee) return 'no_assignee'
    const title = reconciliationTaskTitle(input.period)
    const { data: existing, error: readErr } = await sb.from('staff_tasks').select('id').eq('user_id', input.userId).eq('title', title).limit(1)
    if (readErr) throw new Error(`read tasks failed (${readErr.code ?? 'unknown'})`)
    if (((existing ?? []) as unknown[]).length) return 'exists'
    const { error } = await sb.from('staff_tasks').insert({ user_id: input.userId, title, due_at: input.dueAt, assignee_id: assignee, created_by: 'system:point-b' })
    if (error) throw new Error(`insert task failed (${error.code ?? 'unknown'})`)
    return 'created'
  } catch (err) {
    console.error('[point-b/planfact] reconciliation task not created', msg(err))
    return 'failed'
  }
}
