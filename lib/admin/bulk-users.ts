/**
 * lib/admin/bulk-users.ts — массовые действия над пользователями (F-014).
 *
 * Одно действие над пачкой до 200 человек. Права на само действие
 * проверяются один раз (до чтения данных), а ранг — ПО КАЖДОМУ человеку:
 * сотрудник не может заблокировать или архивировать равного себе или старше,
 * даже если тот случайно попал в выборку. Каждый успешный пункт пишется в
 * журнал отдельно, результат возвращается по каждому id — частичный успех
 * нормален и виден в отчёте.
 */

import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction } from '@/lib/admin/audit'
import { canManageTarget, isStaffRole, type StaffRole } from '@/lib/admin/rbac'
import { BULK_ACTIONS, BULK_MAX, type BulkAction } from './bulk-users-shared'
import type { GigaActor } from '@/lib/admin/giga-actor'
import { applyApprovalDecision } from '@/lib/users/approval'
import { remindSurveyBatch } from '@/lib/admin/survey-reminders'

export { BULK_ACTIONS, BULK_ACTION_LABELS, BULK_MAX, BULK_PERMISSIONS, type BulkAction } from './bulk-users-shared'

export const bulkSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  ids: z.array(z.string().uuid()).min(1, 'Никто не выбран').max(BULK_MAX, `Не больше ${BULK_MAX} за раз`),
  reason: z.string().trim().max(300).optional(),
  tier: z.enum(['free', 'pro']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.action === 'set_tier' && !v.tier) ctx.addIssue({ code: 'custom', message: 'Выберите тариф', path: ['tier'] })
  if (v.action === 'assign' && v.assigneeId === undefined) ctx.addIssue({ code: 'custom', message: 'Выберите ответственного', path: ['assigneeId'] })
  if (v.action === 'archive' && (v.reason ?? '').length < 3) ctx.addIssue({ code: 'custom', message: 'Укажите причину', path: ['reason'] })
})
export type BulkInput = z.infer<typeof bulkSchema>

export interface BulkItemResult { id: string; ok: boolean; error: string | null; skipped?: boolean }

interface Target { id: string; role: string | null; status: string | null; tier: string | null; staffRole: StaffRole | null }

const APPROVABLE = new Set(['pending_approval', 'requires_clarification', 'rejected'])
const REJECTABLE = new Set(['pending_approval', 'requires_clarification'])

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

/** Проверка до чтения данных: ответственным может быть только сотрудник. */
export async function validateAssignee(assigneeId: string | null | undefined): Promise<string | null> {
  if (!assigneeId) return null
  const { data } = await createServiceClient().from('staff_roles').select('user_id').eq('user_id', assigneeId).maybeSingle()
  return data ? null : 'Ответственным может быть только сотрудник'
}

async function loadTargets(ids: string[]): Promise<Map<string, Target>> {
  const sb = createServiceClient()
  const [{ data: profiles, error }, { data: staff }] = await Promise.all([
    sb.from('profiles').select('id, role, status, tier').in('id', ids),
    sb.from('staff_roles').select('user_id, role').in('user_id', ids),
  ])
  if (error) throw new Error(error.message)
  const staffBy = new Map(((staff ?? []) as Array<{ user_id: string; role: string }>).map((s) => [s.user_id, s.role]))
  const out = new Map<string, Target>()
  for (const p of (profiles ?? []) as Array<{ id: string; role: string | null; status: string | null; tier: string | null }>) {
    const r = staffBy.get(p.id)
    const staffRole: StaffRole | null = p.role === 'super_admin' ? 'super_admin' : isStaffRole(r) ? r : null
    out.set(p.id, { id: p.id, role: p.role, status: p.status, tier: p.tier ?? null, staffRole })
  }
  return out
}

/** Причина, по которой к этому человеку действие неприменимо (или null). */
export function targetGuard(actor: Pick<GigaActor, 'id' | 'role'>, action: BulkAction, t: Target | undefined): string | null {
  if (!t) return 'Пользователь не найден'
  if (!canManageTarget(actor.role, t.staffRole)) return 'Недостаточно прав для этого сотрудника'
  if ((action === 'block' || action === 'archive' || action === 'reject') && t.id === actor.id) return 'Нельзя применить к своему аккаунту'
  if ((action === 'block' || action === 'archive') && t.staffRole === 'super_admin') return 'Нельзя применить к Super Admin'
  return null
}

export async function runBulkUserAction(actor: GigaActor, input: BulkInput, req?: Request | null): Promise<BulkItemResult[]> {
  const ids = Array.from(new Set(input.ids))
  const targets = await loadTargets(ids)
  const sb = createServiceClient()
  const results = new Map<string, BulkItemResult>()
  const allowed: string[] = []
  for (const id of ids) {
    const why = targetGuard(actor, input.action, targets.get(id))
    if (why) results.set(id, { id, ok: false, error: why })
    else allowed.push(id)
  }

  const audit = (id: string, action: string, extra: Partial<Parameters<typeof recordAdminAction>[1]> = {}, required = false) =>
    recordAdminAction(actor, {
      action, entityType: 'user', entityId: id, targetUserId: id,
      ...extra,
      metadata: { bulk: true, ...(input.reason ? { reason: input.reason } : {}), ...(extra.metadata ?? {}) },
    }, req, { required })

  if (input.action === 'remind_survey') {
    if (allowed.length) {
      const sent = await remindSurveyBatch(allowed, { fromLabel: actor.email ?? null, note: input.reason ?? null })
      for (const r of sent) {
        results.set(r.userId, { id: r.userId, ok: r.outcome === 'sent', error: r.outcome === 'sent' ? null : r.message, ...(r.outcome === 'skipped' ? { skipped: true } : {}) })
        if (r.outcome === 'sent') await audit(r.userId, 'user.survey_reminded')
      }
    }
    return ids.map((id) => results.get(id) ?? { id, ok: false, error: 'Не обработан' })
  }

  const one = async (id: string): Promise<BulkItemResult> => {
    const t = targets.get(id) as Target
    try {
      switch (input.action) {
        case 'approve':
        case 'reject': {
          const next = input.action === 'approve' ? 'approved' : 'rejected'
          const ok = input.action === 'approve' ? APPROVABLE : REJECTABLE
          if (t.status === next) return { id, ok: true, error: null, skipped: true }
          if (!ok.has(t.status ?? '')) return { id, ok: false, error: `Статус «${t.status ?? '—'}»: действие не применяется` }
          const { affected } = await applyApprovalDecision({
            userId: id,
            status: next,
            reason: input.reason,
            approvedBy: actor.kind === 'session' ? actor.id : undefined,
          })
          if (!affected) return { id, ok: false, error: 'Статус не изменён' }
          await audit(id, input.action === 'approve' ? 'user.approved' : 'user.rejected', { oldValue: { status: t.status }, newValue: { status: next } })
          return { id, ok: true, error: null }
        }
        case 'set_tier': {
          if (t.tier === input.tier) return { id, ok: true, error: null, skipped: true }
          const { data, error } = await sb.from('profiles').update({ tier: input.tier }).eq('id', id).select('id')
          if (error || !data?.length) return { id, ok: false, error: 'Тариф не изменён' }
          await audit(id, 'user.access_changed', { oldValue: { tier: t.tier }, newValue: { tier: input.tier } })
          return { id, ok: true, error: null }
        }
        case 'assign': {
          const now = new Date().toISOString()
          const { data: before } = await sb.from('user_assignments').select('assignee_id').eq('user_id', id).maybeSingle()
          const prev = (before as { assignee_id?: string | null } | null)?.assignee_id ?? null
          if (prev === (input.assigneeId ?? null)) return { id, ok: true, error: null, skipped: true }
          const { error } = await sb.from('user_assignments').upsert({
            user_id: id, assignee_id: input.assigneeId ?? null, assigned_by: actor.id, assigned_at: now, updated_at: now,
          }, { onConflict: 'user_id' })
          if (error) return { id, ok: false, error: 'Не удалось назначить' }
          await audit(id, input.assigneeId ? 'user.assigned' : 'user.unassigned', { oldValue: { assignee_id: prev }, newValue: { assignee_id: input.assigneeId ?? null } })
          return { id, ok: true, error: null }
        }
        case 'block':
        case 'archive': {
          const next = input.action === 'block' ? 'blocked' : 'archived'
          if (t.status === next) return { id, ok: true, error: null, skipped: true }
          // Журнал ДО действия: если записать нельзя — не блокируем.
          await audit(id, input.action === 'block' ? 'user.blocked' : 'user.archived', { oldValue: { status: t.status }, newValue: { status: next } }, true)
          const { data, error } = await sb.from('profiles').update({ status: next, updated_at: new Date().toISOString() }).eq('id', id).select('id')
          if (error || !data?.length) return { id, ok: false, error: 'Статус не обновлён' }
          const ban = await sb.auth.admin.updateUserById(id, { ban_duration: '87600h' })
          if (ban?.error) console.error('[users/bulk] ban failed:', ban.error.message)
          if (input.action === 'archive') {
            await sb.from('impersonation_sessions')
              .update({ ended_at: new Date().toISOString(), end_reason: 'user_archived' })
              .eq('target_user_id', id).is('ended_at', null)
          }
          return { id, ok: true, error: null }
        }
      }
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : 'Ошибка' }
    }
    return { id, ok: false, error: 'Неизвестное действие' }
  }

  const done = await pool(allowed, 5, one)
  for (const r of done) results.set(r.id, r)
  return ids.map((id) => results.get(id) ?? { id, ok: false, error: 'Не обработан' })
}
