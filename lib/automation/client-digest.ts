/**
 * lib/automation/client-digest.ts — еженедельный дайджест клиенту + лучший
 * Next Best Action (F-059). Вызывается из /api/cron/client-digest
 * по понедельникам около 09:30 Алматы (04:26 UTC, R-230).
 *
 * Получают одобренные клиенты с включённой категорией «digest» (хотя бы один
 * канал). Письмо + запись в ленте. Если сказать нечего (нет GRI, задач,
 * материалов и NBA) — дайджест не уходит. Маркер «последний дайджест» и
 * индекс GRI на тот момент хранятся в automation_sends (kind = client_digest),
 * ключ client_digest:<user>:<понедельник> — повторный запуск в ту же неделю
 * ничего не пришлёт. В недельный потолок напоминаний дайджест не входит:
 * это подписка, которую клиент выключает сам.
 */

import { notifyClient } from '@/lib/notifications/notify'
import { categoryPrefs } from '@/lib/notifications/preferences'
import { buildNbaSignals } from '@/lib/nba/signals'
import { selectNextBestAction, type NextBestAction } from '@/lib/nba/select'
import { plural } from '@/lib/crm/digest'
import {
  fetchClientStates,
  fetchGriHistory,
  fetchLastDigests,
  fetchNbaDone,
  fetchOpenPlanTasks,
  fetchPublishedContent,
  fetchPulseWeeks,
  type ContentPage,
  type GriSnapshot,
  type PlanTask,
} from '@/lib/automation/data'
import { getRecipient } from '@/lib/notifications/store'
import { getSetting } from '@/lib/settings/store'
import { addDays, DAY_MS, daysBetween, localDate, mondayOf } from '@/lib/automation/time'
import { maintenanceSkipReason, type MaintenanceSkipReason } from '@/lib/automation/maintenance-gate'
import { dayRotation, runBudget, type RunBudget } from '@/lib/automation/run-budget'
import { beforeDeadline, runBounded } from '@/lib/crm/bounded-run'

export interface DigestInput {
  userId: string
  now: Date
  /** Две последние GRI-оценки (новая первой). */
  gri: GriSnapshot[]
  /** Индекс GRI в прошлом дайджесте, если он был. */
  lastDigestGri: number | null
  lastDigestAt: string | null
  openTasks: PlanTask[]
  newContent: ContentPage[]
  daysSincePulse: number | null
  nbaDone: Set<string>
}

export interface DigestPlan {
  title: string
  body: string
  griIndex: number | null
  nba: NextBestAction | null
  tasksDue: PlanTask[]
}

function fmt(n: number): string {
  return n.toFixed(1).replace('.', ',')
}

/** Лучший NBA по данным дайджеста; выполненные за неделю не предлагаются. */
export function pickDigestNba(input: DigestInput): NextBestAction | null {
  const current = input.gri[0] ?? null
  const nextTask = [...input.openTasks].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))[0]
  const signals = buildNbaSignals({
    hasReport: Boolean(current?.topLimit),
    griMainLimit: current?.topLimit ?? null,
    planNextTask: nextTask ? { id: nextTask.id, title: nextTask.title } : null,
    daysSincePulse: input.daysSincePulse,
    griAssessmentAgeDays: current ? daysBetween(current.createdAt, input.now) : null,
  }).filter((s) => !input.nbaDone.has(s.actionKey))
  return selectNextBestAction(signals, {}, { completedWithinCooldown: (k) => input.nbaDone.has(k) })
}

export function planDigest(input: DigestInput): DigestPlan | null {
  const today = localDate(input.now)
  const weekStart = mondayOf(today)
  const weekEnd = addDays(weekStart, 6)
  const paragraphs: string[] = []

  // 1. Динамика GRI.
  const current = input.gri[0] ?? null
  const griIndex = current?.griIndex ?? null
  if (griIndex !== null) {
    const base = input.lastDigestGri ?? input.gri[1]?.griIndex ?? null
    if (base === null) paragraphs.push(`Индекс GRI: ${fmt(griIndex)} из 10.`)
    else {
      const delta = griIndex - base
      paragraphs.push(
        Math.abs(delta) < 0.05
          ? `Индекс GRI: ${fmt(griIndex)} из 10 — без изменений${input.lastDigestAt ? ' с прошлого дайджеста' : ''}.`
          : `Индекс GRI: ${fmt(griIndex)} из 10 (${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))} ${input.lastDigestAt ? 'с прошлого дайджеста' : 'к прошлой оценке'}).`,
      )
    }
  }

  // 2. Задачи плана со сроком на этой неделе (и просроченные).
  const tasksDue = input.openTasks
    .filter((t) => t.dueDate !== null && t.dueDate <= weekEnd)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  if (tasksDue.length) {
    const overdue = tasksDue.filter((t) => (t.dueDate as string) < weekStart).length
    const lines = tasksDue.slice(0, 5).map((t) => `• ${t.title}${(t.dueDate as string) < weekStart ? ' (просрочено)' : ''}`)
    const more = tasksDue.length > 5 ? `\n…и ещё ${tasksDue.length - 5}` : ''
    paragraphs.push(
      `Задачи плана на эту неделю: ${tasksDue.length}${overdue ? `, из них просрочено ${overdue}` : ''}.\n${lines.join('\n')}${more}`,
    )
  }

  // 3. Новые материалы.
  if (input.newContent.length) {
    const titles = input.newContent.slice(0, 3).map((p) => `• ${p.title}`).join('\n')
    paragraphs.push(
      `${plural(input.newContent.length, 'Новый материал', 'Новых материала', 'Новых материалов')}: ${input.newContent.length}.\n${titles}`,
    )
  }

  // 4. Главный следующий шаг.
  const nba = pickDigestNba(input)
  if (nba) paragraphs.push(`Главный шаг недели: ${nba.title}. ${nba.reason}`)

  if (!paragraphs.length) return null
  return { title: 'Ваша неделя в AIStart360', body: paragraphs.join('\n\n'), griIndex, nba, tasksDue }
}

export interface DigestRunStats {
  eligible: number
  sent: number
  empty: number
  duplicate: number
  disabled: number
  failed: number
  /** Дайджест выключен в настройках платформы (client_digest_enabled). */
  switchedOff: boolean
  /** R-026: the run was skipped as a whole (the cabinet is in maintenance, or that is unknown). */
  skippedReason?: MaintenanceSkipReason
  /** R-015: clients not started — the run's budget was spent. */
  deferred?: number
  /** R-015: sends cut by the run's deadline (a provider that did not answer in time). */
  timedOut?: number
}

export async function runClientDigest(now: Date = new Date(), opts: { budget?: RunBudget } = {}): Promise<DigestRunStats> {
  // R-015: the budget starts with the run — the reads below count against it too.
  const budget = opts.budget ?? runBudget()
  const stats: DigestRunStats = { eligible: 0, sent: 0, empty: 0, duplicate: 0, disabled: 0, failed: 0, switchedOff: false, deferred: 0, timedOut: 0 }
  let enabled = true
  try {
    enabled = await getSetting('client_digest_enabled')
  } catch {
    /* настройки недоступны — по умолчанию включено */
  }
  if (!enabled) return { ...stats, switchedOff: true }
  // R-026: no digest into a cabinet that is closed for maintenance.
  const skip = await maintenanceSkipReason('client-digest')
  if (skip) return { ...stats, skippedReason: skip }
  const approved = (await fetchClientStates()).filter((s) => s.status === 'approved').map((s) => s.user_id)
  if (!approved.length) return stats

  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const [gri, tasks, lastDigests, nbaDone, pulse, content7] = await Promise.all([
    fetchGriHistory(approved),
    fetchOpenPlanTasks(approved),
    fetchLastDigests(approved),
    fetchNbaDone(approved, since7),
    fetchPulseWeeks(approved, addDays(localDate(now), -84)),
    fetchPublishedContent(since7),
  ])
  const week = mondayOf(localDate(now))

  const one = async (userId: string): Promise<void> => {
    // Категория выключена целиком — дайджест не собираем (дешевле, чем notifyClient).
    const profile = await getRecipient(userId)
    if (!profile) return
    const prefs = categoryPrefs(profile.preferences, 'digest')
    if (!prefs.in_app && !(prefs.email && profile.email) && !(prefs.telegram && profile.telegramChatId)) {
      stats.disabled += 1
      return
    }
    stats.eligible += 1

    const last = lastDigests.get(userId) ?? null
    const weeks = pulse.get(userId) ?? []
    const lastPulse = weeks.sort().at(-1)
    const plan = planDigest({
      userId,
      now,
      gri: gri.get(userId) ?? [],
      lastDigestGri: last?.griIndex ?? null,
      lastDigestAt: last?.sentAt ?? null,
      openTasks: tasks.get(userId) ?? [],
      // Материалы — опубликованные после прошлого дайджеста (не старше недели).
      newContent: last ? content7.filter((p) => p.publishedAt > last.sentAt) : content7,
      daysSincePulse: lastPulse ? daysBetween(`${lastPulse}T00:00:00Z`, now) : null,
      nbaDone: nbaDone.get(userId) ?? new Set(),
    })
    if (!plan) {
      stats.empty += 1
      return
    }

    const cut = await beforeDeadline(() => notifyClient(
      {
        userId,
        category: 'digest',
        event: 'client_digest',
        title: plan.title,
        body: plan.body,
        ctaUrl: plan.nba?.cta.href && plan.nba.cta.href.startsWith('/') ? plan.nba.cta.href : '/client/home',
        ctaLabel: plan.nba?.cta.label ?? 'Открыть кабинет',
        eyebrow: 'Дайджест недели',
        dedupeKey: `client_digest:${userId}:${week}`,
        // Маркер в automation_sends, но вне потолка напоминаний.
        automated: { kind: 'client_digest', countsTowardCap: false },
        emailKind: 'client_digest',
        metadata: { gri_index: plan.griIndex, nba: plan.nba?.actionKey ?? null, tasks_due: plan.tasksDue.length },
      },
      now,
    ), budget.deadlineAt, budget.now)
    if (!cut.ok) {
      stats.timedOut = (stats.timedOut ?? 0) + 1
      return
    }
    const res = cut.value
    if (res.skipped === 'duplicate') stats.duplicate += 1
    else if (res.skipped) stats.disabled += 1
    else if (res.ok) stats.sent += 1
    else stats.failed += 1
  }

  // R-015: ≤ 2 clients at a time within the run's budget, in a per-week order (not the same clients
  // left out every Monday); a client not reached is «deferred» — a repeat run the same week sends
  // only to them (the key client_digest:<user>:<monday> makes the others a no-op).
  const run = await runBounded([...approved].sort((a, b) => dayRotation(week, a) - dayRotation(week, b)), budget, one)
  stats.deferred = run.deferred
  if (run.deferred > 0 || (stats.timedOut ?? 0) > 0) {
    console.warn(JSON.stringify({ event: 'automation_budget_spent', job: 'client-digest', deferred: run.deferred, timed_out: stats.timedOut, clients: approved.length }))
  }
  return stats
}
