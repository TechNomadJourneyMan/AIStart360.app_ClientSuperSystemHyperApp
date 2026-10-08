/**
 * lib/admin/escalations.ts — очередь эскалаций (expert_cases) с SLA.
 *
 * Чистые функции (срок реакции, состояние SLA) + серверные помощники:
 * ответственный клиента из `user_assignments` и уведомление ответственного
 * (письмо/Telegram через notifyUser + запись в ленту app_notifications).
 */

import { createServiceClient } from '@/lib/supabase-service'
import { getSetting } from '@/lib/settings/store'
import { SETTINGS } from '@/lib/settings/registry'
import { notifyUser } from '@/lib/notifications'
import { createNotification } from '@/lib/notifications/create'
import { GIGA_BASE, SUPER_EXPERT_BASE } from '@/lib/admin/nav'

export const CASE_STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]
export const CASE_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
export type CasePriority = (typeof CASE_PRIORITIES)[number]
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ['new', 'in_progress']

export type SlaHours = Record<CasePriority, number>
export const DEFAULT_SLA_HOURS: SlaHours = SETTINGS.escalation_sla_hours.default

export function isCaseStatus(v: unknown): v is CaseStatus {
  return typeof v === 'string' && (CASE_STATUSES as readonly string[]).includes(v)
}
export function isCasePriority(v: unknown): v is CasePriority {
  return typeof v === 'string' && (CASE_PRIORITIES as readonly string[]).includes(v)
}

/** Срок реакции: момент создания + часы SLA для приоритета. */
export function computeSlaDueAt(createdAt: Date | string, priority: string, hours: SlaHours = DEFAULT_SLA_HOURS): string {
  const base = typeof createdAt === 'string' ? new Date(createdAt) : createdAt
  const p: CasePriority = isCasePriority(priority) ? priority : 'medium'
  const h = Number.isFinite(hours[p]) && hours[p] > 0 ? hours[p] : DEFAULT_SLA_HOURS[p]
  return new Date(base.getTime() + h * 3_600_000).toISOString()
}

export type SlaState = 'overdue' | 'due_soon' | 'ok' | 'met' | 'none'

/**
 * Состояние SLA кейса:
 *  - закрытый/решённый или уже взятый в работу — 'met' (срок реакции соблюдён
 *    или больше не важен);
 *  - открытый без срока — 'none';
 *  - срок прошёл — 'overdue'; осталось меньше 25 % окна или часа — 'due_soon'.
 */
export function slaState(
  c: { status: string; sla_due_at: string | null; first_response_at?: string | null; created_at?: string | null },
  now: Date = new Date(),
): SlaState {
  if (!OPEN_CASE_STATUSES.includes(c.status as CaseStatus)) return 'met'
  if (c.first_response_at) return 'met'
  if (!c.sla_due_at) return 'none'
  const due = new Date(c.sla_due_at).getTime()
  const left = due - now.getTime()
  if (left <= 0) return 'overdue'
  const created = c.created_at ? new Date(c.created_at).getTime() : NaN
  const window = Number.isFinite(created) ? due - created : 0
  if (left < 3_600_000 || (window > 0 && left < window * 0.25)) return 'due_soon'
  return 'ok'
}

export async function getSlaHours(): Promise<SlaHours> {
  try {
    return await getSetting('escalation_sla_hours')
  } catch {
    return DEFAULT_SLA_HOURS
  }
}

/** Кто ведёт клиента (для авто-назначения кейса). null — никто или таблицы нет. */
export async function responsibleStaffFor(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('user_assignments')
      .select('assignee_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return null
    return (data as { assignee_id?: string | null } | null)?.assignee_id ?? null
  } catch {
    return null
  }
}

/** Ссылка на очередь в том кабинете, где работает сотрудник. */
export async function casesLinkFor(staffId: string, caseId?: string | null): Promise<string> {
  let base = GIGA_BASE
  try {
    const sb = createServiceClient()
    const [{ data: sr }, { data: p }] = await Promise.all([
      sb.from('staff_roles').select('role').eq('user_id', staffId).maybeSingle(),
      sb.from('profiles').select('role').eq('id', staffId).maybeSingle(),
    ])
    const staffRole = (sr as { role?: string } | null)?.role
    const profileRole = (p as { role?: string } | null)?.role
    if (staffRole === 'super_expert' && profileRole !== 'super_admin') base = SUPER_EXPERT_BASE
  } catch {
    /* default to the admin panel */
  }
  return `${base}/cases${caseId ? `?case=${caseId}` : ''}`
}

/**
 * Уведомить ответственного о кейсе: запись в ленте уведомлений (in-app) и
 * письмо/Telegram по его каналам. Никогда не бросает — уведомление не должно
 * ломать создание или назначение кейса.
 */
export async function notifyCaseAssignee(input: {
  assigneeId: string
  caseId: string | null
  clientId: string
  title: string
  priority: string
  triggerType?: string | null
  userMessage?: string | null
  reason: 'created' | 'assigned'
}): Promise<void> {
  try {
    const sb = createServiceClient()
    const { data: client } = await sb.from('profiles').select('full_name, organization, email').eq('id', input.clientId).maybeSingle()
    const c = client as { full_name?: string | null; organization?: string | null; email?: string | null } | null
    const clientName = [c?.full_name, c?.organization].filter(Boolean).join(' · ') || c?.email || 'клиент'
    const link = await casesLinkFor(input.assigneeId, input.caseId)

    await createNotification({
      userId: input.assigneeId,
      category: 'crm',
      priority: input.priority === 'critical' || input.priority === 'high' ? 'high' : 'medium',
      title: input.reason === 'created' ? 'Новая эскалация от вашего клиента' : 'Вам назначена эскалация',
      body: `«${input.title}» — ${clientName}`,
      link,
      metadata: { caseId: input.caseId, clientId: input.clientId, kind: 'expert_case' },
    })

    // userName/userEmail — КЛИЕНТА: без них notifyUser подставил бы имя
    // получателя, и письмо читалось бы как «обращение от вас самих».
    await notifyUser(input.assigneeId, 'expert_case_created', {
      caseId: input.caseId,
      title: input.title,
      priority: input.priority,
      triggerType: input.triggerType ?? 'manual',
      userMessage: input.userMessage ?? null,
      userName: clientName,
      userEmail: c?.email ?? null,
    })
  } catch (err) {
    console.error('[escalations] notify assignee failed:', err instanceof Error ? err.message : err)
  }
}
