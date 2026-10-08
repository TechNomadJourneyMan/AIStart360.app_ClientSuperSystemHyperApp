/**
 * lib/automation/staff-digest.ts — утренняя сводка персоналу (F-060).
 * Вызывается из /api/cron/staff-digest каждый день в 08:00 Алматы.
 *
 *   • Администраторам (каналы notifyAdmins: ADMIN_NOTIFICATION_EMAIL +
 *     Telegram-чаты админов, тип staff_digest выключается в «Настройки →
 *     Уведомления администраторам»): заявки на доступ старше
 *     request_sla_hours (число и возраст самой старой), а также вчерашние
 *     регистрации, отправленные анкеты и пройденные GRI.
 *   • Каждому исполнителю — его собственный список просроченных staff_tasks
 *     (notifyClient, категория «team»; ключ staff_tasks:<исполнитель>:<дата>).
 *     Задачи без исполнителя попадают в сводку админам.
 *
 * Сводка админам уходит, только если есть о чём сказать.
 */

import { notifyAdmins } from '@/lib/notifications'
import { notifyClient } from '@/lib/notifications/notify'
import { claimSend } from '@/lib/notifications/store'
import { plural } from '@/lib/crm/digest'
import { getSetting } from '@/lib/settings/store'
import {
  fetchDayCounts,
  fetchOverdueStaffTasks,
  fetchPendingRequests,
  fetchProfileLabels,
  type DayCounts,
  type PendingRequest,
  type StaffTask,
} from '@/lib/automation/data'
import { addDays, hoursBetween, localDate, startOfLocalDay } from '@/lib/automation/time'

/** Просроченные задачи по исполнителю; без исполнителя — ключ null. */
export function groupTasksByAssignee(tasks: StaffTask[]): Map<string | null, StaffTask[]> {
  const out = new Map<string | null, StaffTask[]>()
  for (const t of tasks) {
    const key = t.assigneeId ?? null
    const list = out.get(key) ?? []
    list.push(t)
    out.set(key, list)
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  return out
}

export interface SlaSummary {
  pending: number
  overdue: number
  oldestHours: number | null
}

export function summarizePending(pending: PendingRequest[], slaHours: number, now: Date): SlaSummary {
  const ages = pending.map((p) => hoursBetween(p.createdAt, now)).filter((h) => h >= 0)
  const overdue = ages.filter((h) => h >= slaHours).length
  return { pending: pending.length, overdue, oldestHours: ages.length ? Math.max(...ages) : null }
}

function ageLabel(hours: number): string {
  if (hours < 48) return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`
  const days = Math.floor(hours / 24)
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`
}

/** Строки сводки админам. Пустой массив — сказать нечего. */
export function buildStaffSummaryLines(input: {
  sla: SlaSummary
  slaHours: number
  yesterday: DayCounts
  unassignedOverdue: number
}): string[] {
  const lines: string[] = []
  const { sla } = input
  if (sla.overdue > 0) {
    lines.push(
      `⏰ Заявки ждут дольше ${input.slaHours} ч: ${sla.overdue} из ${sla.pending}. Самая старая — ${ageLabel(sla.oldestHours ?? 0)}.`,
    )
  } else if (sla.pending > 0) {
    lines.push(`Заявок на доступ в очереди: ${sla.pending} (все моложе ${input.slaHours} ч).`)
  }
  if (input.unassignedOverdue > 0) lines.push(`Просроченных задач без исполнителя: ${input.unassignedOverdue}.`)
  const y = input.yesterday
  if (y.registrations || y.surveysCompleted || y.griCompleted) {
    lines.push(`Вчера: регистраций — ${y.registrations}, анкет отправлено — ${y.surveysCompleted}, GRI пройдено — ${y.griCompleted}.`)
  }
  return lines
}

export function buildAssigneeTaskBody(tasks: StaffTask[], labels: Map<string, string>, now: Date): string {
  const lines = tasks.slice(0, 10).map((t) => {
    const who = t.clientId ? labels.get(t.clientId) : null
    return `• ${t.title}${who ? ` — ${who}` : ''} (просрочено на ${ageLabel(Math.max(1, hoursBetween(t.dueAt, now)))})`
  })
  const more = tasks.length > 10 ? `\n…и ещё ${tasks.length - 10}` : ''
  return `${lines.join('\n')}${more}`
}

export interface StaffDigestStats {
  adminSummarySent: boolean
  pending: number
  pendingOverSla: number
  assigneesNotified: number
  overdueTasks: number
}

export async function runStaffDigest(now: Date = new Date()): Promise<StaffDigestStats> {
  let slaHours = 4
  try {
    slaHours = await getSetting('request_sla_hours')
  } catch {
    /* по умолчанию 4 часа */
  }

  const today = localDate(now)
  const yesterdayFrom = startOfLocalDay(addDays(today, -1)).toISOString()
  const yesterdayTo = startOfLocalDay(today).toISOString()

  const [pending, tasks, yesterday] = await Promise.all([
    fetchPendingRequests(),
    fetchOverdueStaffTasks(now.toISOString()),
    fetchDayCounts(yesterdayFrom, yesterdayTo),
  ])
  const sla = summarizePending(pending, slaHours, now)
  const byAssignee = groupTasksByAssignee(tasks)
  const unassigned = byAssignee.get(null)?.length ?? 0

  const stats: StaffDigestStats = {
    adminSummarySent: false,
    pending: sla.pending,
    pendingOverSla: sla.overdue,
    assigneesNotified: 0,
    overdueTasks: tasks.length,
  }

  // 1. Каждому исполнителю — его просроченные задачи.
  const clientIds = Array.from(new Set(tasks.map((t) => t.clientId).filter((v): v is string => Boolean(v))))
  const labels = clientIds.length ? await fetchProfileLabels(clientIds) : new Map<string, string>()
  for (const [assigneeId, list] of Array.from(byAssignee.entries())) {
    if (!assigneeId) continue
    const res = await notifyClient(
      {
        userId: assigneeId,
        category: 'team',
        event: 'staff_tasks_overdue',
        title: `Просроченных задач: ${list.length}`,
        body: buildAssigneeTaskBody(list, labels, now),
        // Самая старая задача — сразу в карточку клиента, где её закрывают.
        ctaUrl: list[0]?.clientId ? `/admin-giga-panel/users/${list[0].clientId}` : '/admin-giga-panel/users',
        ctaLabel: list[0]?.clientId ? 'Открыть самую старую' : 'Открыть GIGA-CRM',
        eyebrow: 'Мои задачи',
        dedupeKey: `staff_tasks:${assigneeId}:${today}`,
        emailKind: 'staff_tasks',
        metadata: { tasks: list.length },
      },
      now,
    )
    if (res.ok) stats.assigneesNotified += 1
  }

  // 2. Сводка администраторам.
  const lines = buildStaffSummaryLines({ sla, slaHours, yesterday, unassignedOverdue: unassigned })
  // Идемпотентно: одна сводка в сутки, даже если cron перезапустили.
  const claim = lines.length
    ? await claimSend({ userId: null, kind: 'staff_digest', dedupeKey: `staff_digest:${today}`, countsTowardCap: false, channels: ['admin'] })
    : null
  if (claim && claim.result !== 'duplicate') {
    await notifyAdmins('staff_digest', {
      id: `staff_digest:${today}`,
      title: sla.overdue > 0 ? `Утренняя сводка: ${sla.overdue} ${plural(sla.overdue, 'заявка ждёт', 'заявки ждут', 'заявок ждут')}` : 'Утренняя сводка',
      lines,
    })
    stats.adminSummarySent = true
  }
  return stats
}
