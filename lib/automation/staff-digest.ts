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
 *       – окончание платного доступа: кому за последние сутки ушло
 *         предупреждение «за 7 дней», «за сутки» и «закончился» — по журналу
 *         отправок клиенту, поэтому каждый клиент и этап — ОДИН раз (WB-3);
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
  fetchProNoticesSince,
  fetchProfileLabels,
  type DayCounts,
  type PendingRequest,
  type ProNoticeRow,
  type StaffTask,
} from '@/lib/automation/data'
import { addDays, hoursBetween, localDate, startOfLocalDay } from '@/lib/automation/time'
import { dayRotation, runBudget, type RunBudget } from '@/lib/automation/run-budget'
import { beforeDeadline, runBounded } from '@/lib/crm/bounded-run'

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

function proList(rows: ProNoticeRow[], labels: Map<string, string>): string {
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
  /** Предупреждения об окончании платного доступа, ушедшие клиентам за сутки (N4B-10, WB-3). */
  proNotices?: ProNoticeRow[]
  labels?: Map<string, string>
}): string[] {
  const lines: string[] = []
  const labels = input.labels ?? new Map<string, string>()
  const paid = input.paid ? slaLine('paid', input.paid, input.slaHours) : null
  if (paid) lines.push(paid)
  const reg = slaLine('registration', input.sla, input.slaHours)
  if (reg) lines.push(reg)
  const byStage = (stage: ProNoticeRow['stage']) => (input.proNotices ?? []).filter((r) => r.stage === stage)
  const d7 = byStage('d7')
  const d1 = byStage('d1')
  const ended = byStage('ended')
  if (d7.length) lines.push(`Платный доступ кончается в течение недели (клиент предупреждён): ${d7.length} — ${proList(d7, labels)}.`)
  if (d1.length) lines.push(`Платный доступ кончается в течение суток (клиент предупреждён): ${d1.length} — ${proList(d1, labels)}.`)
  if (ended.length) lines.push(`Платный доступ закончился, кабинет переведён на бесплатный: ${ended.length} — ${proList(ended, labels)}.`)
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
  /** Предупреждения клиентам за сутки: «кончается» (7 дней и сутки) / «закончился» (N4B-10, WB-3). */
  proEnding: number
  proEnded: number
  assigneesNotified: number
  overdueTasks: number
  /** R-015: assignees not started — the run's budget was spent. */
  deferred: number
  /** R-015: sends cut by the run's deadline (a provider that did not answer in time). */
  timedOut: number
  /** R-015: the admin summary was claimed but its send did not answer before the deadline. */
  adminSummaryTimedOut?: boolean
}

export async function runStaffDigest(now: Date = new Date(), opts: { budget?: RunBudget } = {}): Promise<StaffDigestStats> {
  // R-015: the budget starts with the run — the reads below count against it too.
  const budget = opts.budget ?? runBudget()
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
  const [pending, paidRows, tasks, yesterday, proNotices] = await Promise.all([
    fetchPendingRequests(),
    // Заявки на оплату: сбой чтения не отменяет остальную сводку.
    fetchOpenPaidRequests().catch((err) => {
      console.error('[staff-digest] paid requests unavailable:', err instanceof Error ? err.message : err)
      return [] as PendingRequest[]
    }),
    fetchOverdueStaffTasks(now.toISOString()),
    fetchDayCounts(yesterdayFrom, yesterdayTo),
    // Сутки до этой сводки: ночной крон billing-expiry (00:15 UTC) попадает ровно в одну сводку.
    fetchProNoticesSince(new Date(now.getTime() - DAY).toISOString()),
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
    proEnding: proNotices.filter((r) => r.stage !== 'ended').length,
    proEnded: proNotices.filter((r) => r.stage === 'ended').length,
    assigneesNotified: 0,
    overdueTasks: tasks.length,
    deferred: 0,
    timedOut: 0,
  }

  const clientIds = Array.from(new Set([
    ...tasks.map((t) => t.clientId),
    ...proNotices.map((r) => r.userId),
  ].filter((v): v is string => Boolean(v))))
  const labels = clientIds.length ? await fetchProfileLabels(clientIds) : new Map<string, string>()

  // 1. Сводка администраторам — первой (R-015): она важнее и не зависит от рассылки исполнителям,
  //    так что долгая рассылка не съедает её время.
  const lines = buildStaffSummaryLines({ paid, sla, slaHours, yesterday, unassignedOverdue: unassigned, proNotices, labels })
  // Идемпотентно: одна сводка в сутки, даже если cron перезапустили.
  const claim = lines.length
    ? await claimSend({ userId: null, kind: 'staff_digest', dedupeKey: `staff_digest:${today}`, countsTowardCap: false, channels: ['admin'] })
    : null
  if (claim && claim.result !== 'duplicate') {
    const sent = await beforeDeadline(() => notifyAdmins('staff_digest', {
      id: `staff_digest:${today}`,
      title: staffSummaryTitle(paid, sla),
      lines,
    }), budget.deadlineAt, budget.now)
    // Cut at the deadline: the send is abandoned, not cancelled — it may still arrive; the claim stays
    // (no second summary today), and the run says it did not see it through.
    if (sent.ok) stats.adminSummarySent = true
    else stats.adminSummaryTimedOut = true
  }

  // 2. Каждому исполнителю — его просроченные задачи: ≤ 2 одновременно, в бюджете прогона.
  const assignees = Array.from(byAssignee.entries())
    .filter((e): e is [string, StaffTask[]] => Boolean(e[0]))
    .sort((a, b) => dayRotation(today, a[0]) - dayRotation(today, b[0]))
  const run = await runBounded(assignees, budget, async ([assigneeId, list]) => {
    const cut = await beforeDeadline(() => notifyClient(
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
    ), budget.deadlineAt, budget.now)
    if (!cut.ok) stats.timedOut += 1
    else if (cut.value.ok) stats.assigneesNotified += 1
  })
  stats.deferred = run.deferred
  if (run.deferred > 0 || stats.timedOut > 0 || stats.adminSummaryTimedOut) {
    console.warn(JSON.stringify({ event: 'automation_budget_spent', job: 'staff-digest', deferred: run.deferred, timed_out: stats.timedOut, admin_summary_timed_out: Boolean(stats.adminSummaryTimedOut) }))
  }
  return stats
}
