/**
 * lib/automation/staff-digest.ts — утренняя сводка персоналу (F-060).
 * Вызывается из /api/cron/staff-digest каждый день в 08:00 Алматы.
 *
 *   • Администраторам (каналы notifyAdmins: ADMIN_NOTIFICATION_EMAIL +
 *     Telegram-чаты админов, тип staff_digest выключается в «Настройки →
 *     Уведомления администраторам»), отдельными строками (R4, N4B-1 / N4B-10):
 *       – заявки на ОПЛАТУ (admin_requests, пейволл) — сколько открыто, сколько
 *         ждут дольше request_sla_hours, возраст самой старой;
 *       – РЕГИСТРАЦИИ, ждущие одобрения (profiles pending_approval) — так же;
 *       – у кого платный доступ кончается в ближайшие 7 суток и кого ночной
 *         крон перевёл на бесплатный за последние сутки;
 *       – вчерашние регистрации, отправленные анкеты и пройденные GRI.
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
  fetchOpenPaidRequests,
  fetchOverdueStaffTasks,
  fetchPendingRequests,
  fetchProEndedSince,
  fetchProEnding,
  fetchProfileLabels,
  type DayCounts,
  type PendingRequest,
  type ProEndingRow,
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

function slaLine(kind: 'paid' | 'registration', sla: SlaSummary, slaHours: number): string | null {
  const what = kind === 'paid' ? 'Заявки на оплату' : 'Регистрации ждут одобрения'
  if (sla.overdue > 0) {
    return `${kind === 'paid' ? '💳' : '⏰'} ${what} — дольше ${slaHours} ч: ${sla.overdue} из ${sla.pending}. Самая старая — ${ageLabel(sla.oldestHours ?? 0)}.`
  }
  if (sla.pending > 0) return `${what}: ${sla.pending} (все моложе ${slaHours} ч).`
  return null
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })

function proList(rows: ProEndingRow[], labels: Map<string, string>): string {
  const shown = rows.slice(0, 5).map((r) => `${labels.get(r.userId) ?? 'клиент'} (${DATE_FMT.format(new Date(r.endsAt))})`)
  return `${shown.join(', ')}${rows.length > 5 ? ` и ещё ${rows.length - 5}` : ''}`
}

/** Строки сводки админам. Пустой массив — сказать нечего. */
export function buildStaffSummaryLines(input: {
  /** Заявки на оплату (N4B-1). */
  paid?: SlaSummary
  /** Регистрации, ждущие одобрения. */
  sla: SlaSummary
  slaHours: number
  yesterday: DayCounts
  unassignedOverdue: number
  /** Платный доступ кончается в ближайшие 7 суток / закончился за сутки (N4B-10). */
  proEnding?: ProEndingRow[]
  proEnded?: ProEndingRow[]
  labels?: Map<string, string>
}): string[] {
  const lines: string[] = []
  const labels = input.labels ?? new Map<string, string>()
  const paid = input.paid ? slaLine('paid', input.paid, input.slaHours) : null
  if (paid) lines.push(paid)
  const reg = slaLine('registration', input.sla, input.slaHours)
  if (reg) lines.push(reg)
  if (input.proEnding?.length) lines.push(`Платный доступ кончается в ближайшие 7 дней: ${input.proEnding.length} — ${proList(input.proEnding, labels)}.`)
  if (input.proEnded?.length) lines.push(`Платный доступ закончился за сутки, кабинет переведён на бесплатный: ${input.proEnded.length} — ${proList(input.proEnded, labels)}.`)
  if (input.unassignedOverdue > 0) lines.push(`Просроченных задач без исполнителя: ${input.unassignedOverdue}.`)
  const y = input.yesterday
  if (y.registrations || y.surveysCompleted || y.griCompleted) {
    lines.push(`Вчера: регистраций — ${y.registrations}, анкет отправлено — ${y.surveysCompleted}, GRI пройдено — ${y.griCompleted}.`)
  }
  return lines
}

/** Заголовок сводки: сначала заявки на оплату, потом регистрации. */
export function staffSummaryTitle(paid: SlaSummary, registrations: SlaSummary): string {
  if (paid.overdue > 0) return `Утренняя сводка: ${paid.overdue} ${plural(paid.overdue, 'заявка на оплату ждёт', 'заявки на оплату ждут', 'заявок на оплату ждут')}`
  if (registrations.overdue > 0) return `Утренняя сводка: ${registrations.overdue} ${plural(registrations.overdue, 'регистрация ждёт', 'регистрации ждут', 'регистраций ждут')} одобрения`
  return 'Утренняя сводка'
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
  /** Регистрации, ждущие одобрения. */
  pending: number
  pendingOverSla: number
  /** Заявки на оплату (N4B-1). */
  paidPending: number
  paidOverSla: number
  /** Платный доступ кончается в 7 суток / закончился за сутки (N4B-10). */
  proEnding: number
  proEnded: number
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

  const DAY = 24 * 3_600_000
  const [pending, paidRows, tasks, yesterday, proEnding, proEnded] = await Promise.all([
    fetchPendingRequests(),
    // Заявки на оплату: сбой чтения не отменяет остальную сводку.
    fetchOpenPaidRequests().catch((err) => {
      console.error('[staff-digest] paid requests unavailable:', err instanceof Error ? err.message : err)
      return [] as PendingRequest[]
    }),
    fetchOverdueStaffTasks(now.toISOString()),
    fetchDayCounts(yesterdayFrom, yesterdayTo),
    fetchProEnding(now.toISOString(), new Date(now.getTime() + 7 * DAY).toISOString()),
    fetchProEndedSince(new Date(now.getTime() - DAY).toISOString()),
  ])
  const sla = summarizePending(pending, slaHours, now)
  const paid = summarizePending(paidRows, slaHours, now)
  const byAssignee = groupTasksByAssignee(tasks)
  const unassigned = byAssignee.get(null)?.length ?? 0

  const stats: StaffDigestStats = {
    adminSummarySent: false,
    pending: sla.pending,
    pendingOverSla: sla.overdue,
    paidPending: paid.pending,
    paidOverSla: paid.overdue,
    proEnding: proEnding.length,
    proEnded: proEnded.length,
    assigneesNotified: 0,
    overdueTasks: tasks.length,
  }

  // 1. Каждому исполнителю — его просроченные задачи.
  const clientIds = Array.from(new Set([
    ...tasks.map((t) => t.clientId),
    ...proEnding.map((r) => r.userId),
    ...proEnded.map((r) => r.userId),
  ].filter((v): v is string => Boolean(v))))
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
  const lines = buildStaffSummaryLines({ paid, sla, slaHours, yesterday, unassignedOverdue: unassigned, proEnding, proEnded, labels })
  // Идемпотентно: одна сводка в сутки, даже если cron перезапустили.
  const claim = lines.length
    ? await claimSend({ userId: null, kind: 'staff_digest', dedupeKey: `staff_digest:${today}`, countsTowardCap: false, channels: ['admin'] })
    : null
  if (claim && claim.result !== 'duplicate') {
    await notifyAdmins('staff_digest', {
      id: `staff_digest:${today}`,
      title: staffSummaryTitle(paid, sla),
      lines,
    })
    stats.adminSummarySent = true
  }
  return stats
}
