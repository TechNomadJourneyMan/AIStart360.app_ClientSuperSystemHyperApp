/**
 * lib/expert-sla/assign.ts — кто ведёт задачу эксперта.
 *
 * Правило (решение PO «экспертов 1–2», R2-B):
 *   1. У задачи уже есть исполнитель — назначенный в «Эскалациях» или
 *      ответственный клиента (user_assignments), и он может вести экспертную
 *      работу (SLA_WORKER: одобренный эксперт или staff super_admin / admin /
 *      super_expert) — его и оставляем (это делает expert_sla_sync, миграция 145).
 *   2. У клиента НЕТ ответственного и включено «Назначать автоматически» —
 *      наименее загруженный активный эксперт (меньше открытых задач → меньше
 *      клиентов → дольше всех без нового назначения → по id): он становится
 *      ответственным клиента (user_assignments), иначе по правилу 140 он не
 *      увидит данных клиента.
 *   3. Иначе (ответственный — не эксперт, экспертов нет, авто выключено) —
 *      общая очередь: исполнителя нет, SuperExpert получает уведомление и берёт
 *      задачу себе или переназначает (ГИГА «SLA экспертов»).
 * Ответственного клиента механизм НИКОГДА не меняет сам — только заполняет пустое.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Staff-роли, которые могут вести экспертную работу (вместе с profiles.role = 'expert'). Синхронно с expert_sla_is_worker (145). */
export const SLA_WORKER_STAFF = ['super_admin', 'admin', 'super_expert'] as const

export interface Candidate {
  id: string
  /** Открытые SLA-задачи на нём. */
  openTasks: number
  /** Закреплённые клиенты (user_assignments). */
  clients: number
  /** Когда ему последний раз назначили задачу (null — никогда). */
  lastAssignedAt: string | null
}

/** Наименее загруженный: открытых задач → клиентов → давность последнего назначения (по очереди) → id. */
export function pickLeastLoaded(candidates: readonly Candidate[]): Candidate | null {
  if (!candidates.length) return null
  return [...candidates].sort((a, b) =>
    a.openTasks - b.openTasks
    || a.clients - b.clients
    || (a.lastAssignedAt ?? '').localeCompare(b.lastAssignedAt ?? '')
    || a.id.localeCompare(b.id),
  )[0]
}

/** Чистое правило «может ли человек вести экспертную работу» по его строкам. */
export function isSlaWorkerRow(profile: { role?: string | null; status?: string | null } | null, staffRole: string | null | undefined): boolean {
  if (!profile || profile.status !== 'approved') return false
  if (profile.role === 'expert') return true
  return !!staffRole && (SLA_WORKER_STAFF as readonly string[]).includes(staffRole)
}

type Sb = Pick<SupabaseClient, 'from'>

/** Может ли `userId` вести экспертную работу (то же, что expert_sla_is_worker). false при ошибке чтения. */
export async function isSlaWorker(sb: Sb, userId: string): Promise<boolean> {
  try {
    const [{ data: profile, error: pErr }, { data: staff, error: sErr }] = await Promise.all([
      sb.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
      sb.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
    ])
    if (pErr || sErr) return false
    return isSlaWorkerRow(profile as { role?: string; status?: string } | null, (staff as { role?: string } | null)?.role)
  } catch {
    return false
  }
}

/**
 * Активные эксперты (profiles.role = 'expert', approved) с нагрузкой. Только
 * эксперты: SuperExpert и Admin — не кандидаты авто-назначения, они разбирают
 * общую очередь.
 */
export async function loadExpertCandidates(sb: Sb): Promise<Candidate[]> {
  const { data: experts, error } = await sb.from('profiles').select('id').eq('role', 'expert').eq('status', 'approved').limit(50)
  if (error) throw new Error(`expert-sla candidates: ${error.message?.slice(0, 120)}`)
  const ids = ((experts ?? []) as Array<{ id: string }>).map((e) => e.id)
  if (!ids.length) return []
  const [{ data: tasks, error: tErr }, { data: clients, error: cErr }, { data: recent, error: rErr }] = await Promise.all([
    sb.from('expert_sla_tasks').select('assignee_id').in('assignee_id', ids).is('closed_at', null).limit(5000),
    sb.from('user_assignments').select('assignee_id').in('assignee_id', ids).limit(10000),
    sb.from('expert_sla_tasks').select('assignee_id, assigned_at').in('assignee_id', ids).not('assigned_at', 'is', null)
      .order('assigned_at', { ascending: false }).limit(500),
  ])
  if (tErr || cErr || rErr) throw new Error('expert-sla candidates: load unavailable')
  const count = (rows: Array<{ assignee_id: string | null }> | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) if (r.assignee_id) m.set(r.assignee_id, (m.get(r.assignee_id) ?? 0) + 1)
    return m
  }
  const open = count(tasks as Array<{ assignee_id: string | null }> | null)
  const held = count(clients as Array<{ assignee_id: string | null }> | null)
  const last = new Map<string, string>()
  for (const r of (recent ?? []) as Array<{ assignee_id: string | null; assigned_at: string | null }>) {
    if (r.assignee_id && r.assigned_at && !last.has(r.assignee_id)) last.set(r.assignee_id, r.assigned_at)
  }
  return ids.map((id) => ({ id, openTasks: open.get(id) ?? 0, clients: held.get(id) ?? 0, lastAssignedAt: last.get(id) ?? null }))
}

/**
 * Сделать эксперта ответственным клиента, ТОЛЬКО если ответственного нет.
 * Возвращает ответственного после попытки (кто-то мог успеть раньше) или null
 * при ошибке. Никогда не перезаписывает существующего ответственного.
 */
export async function claimUnassignedClient(sb: Sb, clientId: string, expertId: string, now: Date): Promise<string | null> {
  const at = now.toISOString()
  // Строка без ответственного (снятое назначение) — заполняем только пустое.
  const upd = await sb.from('user_assignments')
    .update({ assignee_id: expertId, assigned_by: 'system:expert-sla', assigned_at: at, updated_at: at })
    .eq('user_id', clientId).is('assignee_id', null).select('user_id')
  if (upd.error) return null
  if (!(upd.data as unknown[] | null)?.length) {
    const ins = await sb.from('user_assignments')
      .upsert({ user_id: clientId, assignee_id: expertId, assigned_by: 'system:expert-sla', assigned_at: at, updated_at: at },
        { onConflict: 'user_id', ignoreDuplicates: true })
    if (ins.error) return null
  }
  const { data, error } = await sb.from('user_assignments').select('assignee_id').eq('user_id', clientId).maybeSingle()
  if (error) return null
  return (data as { assignee_id?: string | null } | null)?.assignee_id ?? null
}

/**
 * Может ли человек быть ответственным клиента (user_assignments): любой
 * сотрудник со строкой staff_roles (как было) ИЛИ одобренный эксперт
 * (profiles.role = 'expert' — эксперты не роль staff_roles, D1). Без второго
 * эксперта нельзя было назначить клиентов: эксперт видит только назначенных
 * (правило 140), а все пути назначения принимали только staff_roles.
 */
export async function isAssignableResponsible(sb: Sb, userId: string): Promise<boolean> {
  const [{ data: staff }, { data: profile }] = await Promise.all([
    sb.from('staff_roles').select('user_id').eq('user_id', userId).maybeSingle(),
    sb.from('profiles').select('role, status').eq('id', userId).maybeSingle(),
  ])
  if (staff) return true
  const p = profile as { role?: string | null; status?: string | null } | null
  return p?.role === 'expert' && p?.status === 'approved'
}
