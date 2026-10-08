/**
 * lib/agents/lifecycle.ts — the agent notifier: tells staff what agent tasks
 * do, through the leveled staff notifications (lib/notifications/staff.ts,
 * 087): the GIGA feed row plus the admin bot for linked staff whose role has
 * agents.view, by each person's own level and mute.
 *
 *   started            INFO      once per task (first attempt only)
 *   succeeded          INFO      once per attempt
 *   failed, will retry WARNING   once per attempt (agents_auto_retry on)
 *   dead-letter        CRITICAL  once per attempt — always, even with the
 *                                lifecycle switch off
 *   stuck              CRITICAL  once per task (lease expired / no progress
 *                                for agents_stuck_minutes) — agents_stuck_alerts
 *   awaiting approval  —         the approval card (APPROVAL_REQUESTED →
 *                                APPROVAL_REQUIRED with Approve / Reject)
 *                                already tells the approvers; no duplicate.
 *
 * Idempotency: every message has a dedupe key (task, event[, attempt]) on
 * notification_events; a repeated call never re-notifies anyone. Anti-spam:
 * more than BURST_THRESHOLD tasks started within BURST_WINDOW_MINUTES → one
 * summary per window instead of a message per start; the per-type cooldown
 * of notifyStaff applies to INFO / WARNING.
 *
 * Buttons (admin bot only — signed callbacks are bot-specific): «Открыть»
 * (GIGA task page), «Повторить» (dead-letter → tk.rq) and «Отменить» (a
 * queued retry / a stuck task → tk.cn). Both actions ask for confirmation and
 * check agents.run in the bot (lib/telegram/bots/admin/agents.ts) and are
 * audited by agentTaskAction.
 *
 * Errors never carry secrets or personal data: only the tenant-safe error
 * code and message the runtime already stores, scrubbed and shortened.
 * Hooked in one place: lib/agents/queue.ts runAndReport (both claim paths).
 * Never throws.
 */
import { prisma } from '@/lib/db'
import { notifyStaff, type StaffNotification } from '@/lib/notifications/staff'
import type { OrderedLevel } from '@/lib/notifications/levels'
import { getSetting } from '@/lib/settings/store'
import { getSiteUrl } from '@/lib/site-url'
import { signCallback } from '@/lib/telegram/bots/callback'
import type { BotId, InlineButton } from '@/lib/telegram/bots/registry'
import { automationEnabled, automationSetting } from './automation'
import { getAgent } from './registry'
import type { RunReport } from './runner'
import type { AgentTaskRow } from './types'

export type LifecycleKind = 'started' | 'succeeded' | 'retrying' | 'dead' | 'stuck'

export const BURST_WINDOW_MINUTES = 2
export const BURST_THRESHOLD = 5

export interface LifecycleInput {
  kind: LifecycleKind
  taskId: string
  agentKey: string
  agentName: string
  companyName: string | null
  companyId: string | null
  attempt: number
  maxAttempts: number
  errorCode?: string | null
  errorMessage?: string | null
  summary?: string | null
  /** stuck: the lease expired (else: no progress for `idleMinutes`). */
  leaseExpired?: boolean
  idleMinutes?: number | null
}

const LEVEL: Record<LifecycleKind, StaffNotification['level']> = {
  started: 'INFO', succeeded: 'INFO', retrying: 'WARNING', dead: 'CRITICAL', stuck: 'CRITICAL',
}

const cutText = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/**
 * A short, shareable error line: the code plus the stored message with
 * anything that could be a link, an address, a phone number or a key removed.
 */
export function safeErrorText(code: string | null | undefined, message: string | null | undefined): string | null {
  const m = cutText(String(message ?? '')
    .replace(/https?:\/\/\S+/gi, '[ссылка]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(?:sk|pk|rk|key|token)[-_][A-Za-z0-9_-]{6,}/gi, '[ключ]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[…]')
    .replace(/\+?\d[\d\s()-]{8,}\d/g, '[номер]')
    .replace(/\s+/g, ' ')
    .trim(), 160)
  const c = code && /^[A-Z0-9_]{2,60}$/.test(code) ? code : null
  if (c && m && m !== c) return `${c} — ${m}`
  return c ?? (m || null)
}

export function taskLink(taskId: string): string {
  return `/admin-giga-panel/agents/tasks/${taskId}`
}

/** «Открыть» / «Повторить» / «Отменить» for a lifecycle message, per bot. */
export function lifecycleKeyboard(kind: LifecycleKind, taskId: string, bot: BotId): InlineButton[][] {
  const rows: InlineButton[][] = []
  const url = getSiteUrl(taskLink(taskId))
  // Telegram rejects the whole message for a non-https URL button.
  if (url.startsWith('https://')) rows.push([{ text: '🔎 Открыть', url }])
  if (bot !== 'admin') return rows
  const actions: InlineButton[] = []
  if (kind === 'dead') {
    const data = signCallback('admin', 'tk.rq', taskId)
    if (data) actions.push({ text: '🔁 Повторить', callback_data: data })
  }
  if (kind === 'retrying' || kind === 'stuck') {
    const data = signCallback('admin', 'tk.cn', taskId)
    if (data) actions.push({ text: '✖️ Отменить', callback_data: data })
  }
  if (actions.length) rows.push(actions)
  return rows
}

/** The staff notification of one lifecycle event (pure). */
export function lifecycleNotification(i: LifecycleInput): StaffNotification {
  const name = `«${i.agentName}»`
  const title = {
    started: `Агент ${name} начал задачу`,
    succeeded: `Агент ${name} выполнил задачу`,
    retrying: `Агент ${name}: ошибка, задача будет повторена`,
    dead: `Агент ${name} не справился — попытки исчерпаны`,
    stuck: `Агент ${name}: задача зависла`,
  }[i.kind]
  const error = i.kind === 'retrying' || i.kind === 'dead' ? safeErrorText(i.errorCode, i.errorMessage) : null
  const lines = [
    i.companyName ? `Компания: ${i.companyName}` : i.companyId ? 'Компания: —' : 'Задача платформы',
    `Попытка ${i.attempt}/${i.maxAttempts}`,
    i.kind === 'succeeded' && i.summary ? `Итог: ${cutText(i.summary.replace(/\s+/g, ' '), 200)}` : null,
    error ? `Ошибка: ${error}` : null,
    i.kind === 'retrying' ? 'Повтор — автоматически, с растущей паузой.' : null,
    i.kind === 'dead' ? 'Задача в dead-letter: повторите или разберите причину в панели.' : null,
    i.kind === 'stuck'
      ? i.leaseExpired
        ? 'Исполнитель не завершил задачу до истечения аренды — очередь вернёт её на повтор.'
        : `Нет прогресса больше ${i.idleMinutes ?? '?'} мин.`
      : null,
  ].filter((l): l is string => Boolean(l))
  const dedupe = i.kind === 'started' || i.kind === 'stuck'
    ? `agent:${i.taskId}:${i.kind}`
    : `agent:${i.taskId}:${i.kind}:${i.attempt}`
  return {
    level: LEVEL[i.kind],
    type: `agent.${i.kind}`,
    title,
    lines,
    companyId: i.companyId,
    entityType: 'agent_task',
    entityId: i.taskId,
    agentKey: i.agentKey,
    data: { task_id: i.taskId, kind: i.kind, attempt: i.attempt, error_code: i.errorCode ?? null },
    dedupeKey: dedupe,
    link: taskLink(i.taskId),
    audiencePermission: 'agents.view',
    telegramKeyboard: (bot) => lifecycleKeyboard(i.kind, i.taskId, bot),
  }
}

/** Lifecycle news go to Telegram from the level set in agents_notify_telegram_level (default INFO). */
function withAgentsTelegramLevel(fn: typeof notifyStaff): typeof notifyStaff {
  return async (n, opts) => {
    let level: OrderedLevel = 'INFO'
    try {
      level = await getSetting('agents_notify_telegram_level')
    } catch {
      /* settings unavailable: default */
    }
    return fn({ ...n, telegramMinLevel: level }, opts)
  }
}

export interface NotifyDeps {
  notify?: typeof notifyStaff
  now?: Date
}

type TaskLike = Pick<AgentTaskRow, 'id' | 'agent_key' | 'company_id' | 'attempts' | 'max_attempts'>

async function companyName(companyId: string | null): Promise<string | null> {
  if (!companyId) return null
  const rows = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT name FROM public.companies WHERE id = ${companyId}`
  return rows[0]?.name ?? null
}

function agentName(key: string): string {
  return getAgent(key)?.name ?? key
}

async function inputFor(kind: LifecycleKind, task: TaskLike, extra: Partial<LifecycleInput> = {}): Promise<LifecycleInput> {
  return {
    kind,
    taskId: task.id,
    agentKey: task.agent_key,
    agentName: agentName(task.agent_key),
    companyId: task.company_id,
    companyName: await companyName(task.company_id),
    attempt: task.attempts,
    maxAttempts: task.max_attempts,
    ...extra,
  }
}

export type StartedOutcome = 'disabled' | 'repeat_attempt' | 'sent' | 'summary'

/** A task was claimed and is about to run. */
export async function notifyTaskStarted(task: TaskLike, deps: NotifyDeps = {}): Promise<StartedOutcome> {
  const notify = withAgentsTelegramLevel(deps.notify ?? notifyStaff)
  if (!(await automationEnabled('agents_notify_lifecycle'))) return 'disabled'
  // One «started» per task: retries, approval re-runs and recovered leases are not news.
  if (task.attempts > 1) return 'repeat_attempt'
  const [burst] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM public.agent_tasks
    WHERE started_at > now() - make_interval(mins => ${BURST_WINDOW_MINUTES}::int)`
  const started = Number(burst?.n ?? 0)
  if (started > BURST_THRESHOLD) {
    const top = await prisma.$queryRaw<Array<{ agent_key: string; n: number }>>`
      SELECT agent_key, count(*)::int AS n FROM public.agent_tasks
      WHERE started_at > now() - make_interval(mins => ${BURST_WINDOW_MINUTES}::int)
      GROUP BY agent_key ORDER BY 2 DESC, 1 LIMIT 3`
    const now = deps.now ?? new Date()
    const bucket = Math.floor(now.getTime() / (BURST_WINDOW_MINUTES * 60_000))
    await notify({
      level: 'INFO',
      type: 'agent.started_burst',
      title: 'Массовый запуск задач агентов',
      lines: [
        `За ${BURST_WINDOW_MINUTES} мин запущено задач: ${started}. Сообщения о каждом старте свёрнуты в эту сводку.`,
        top.length ? `Больше всего: ${top.map((t) => `${agentName(t.agent_key)} × ${t.n}`).join(', ')}` : null,
      ].filter((l): l is string => Boolean(l)),
      dedupeKey: `agent:started-burst:${bucket}`,
      link: '/admin-giga-panel/agents/tasks',
      audiencePermission: 'agents.view',
      telegramKeyboard: () => {
        const url = getSiteUrl('/admin-giga-panel/agents/tasks')
        return url.startsWith('https://') ? [[{ text: '🔎 Открыть задачи', url }]] : []
      },
    })
    return 'summary'
  }
  await notify(lifecycleNotification(await inputFor('started', task)))
  return 'sent'
}

export type FinishedOutcome = 'disabled' | 'ignored' | LifecycleKind

/** A run finished: report the task's new status (runner's finalStatus). */
export async function notifyTaskFinished(task: TaskLike, report: RunReport, deps: NotifyDeps = {}): Promise<FinishedOutcome> {
  const notify = withAgentsTelegramLevel(deps.notify ?? notifyStaff)
  let kind: LifecycleKind | null = null
  if (report.finalStatus === 'succeeded') kind = 'succeeded'
  // 'queued' after a failure = a retry is scheduled (an early approval re-queue is not a failure).
  else if (report.finalStatus === 'queued' && report.errorCode && report.errorCode !== 'APPROVAL_REQUIRED') kind = 'retrying'
  else if (report.finalStatus === 'dead') kind = 'dead'
  if (!kind) return 'ignored'
  if (kind !== 'dead' && !(await automationEnabled('agents_notify_lifecycle'))) return 'disabled'
  await notify(lifecycleNotification(await inputFor(kind, task, {
    errorCode: report.errorCode,
    errorMessage: report.errorMessage ?? null,
    summary: report.summary,
  })))
  return kind
}

export interface StuckTask {
  id: string
  agent_key: string
  company_id: string | null
  company_name: string | null
  attempts: number
  max_attempts: number
  lease_expired: boolean
  last_progress_at: Date | null
}

/**
 * Running tasks that are stuck and were not reported yet: the lease expired
 * (the worker died or overran), or the current run has written no event for
 * `minutes`. Bounded: running tasks are few (agent_tasks_running_idx).
 */
export async function findStuckTasks(minutes: number): Promise<StuckTask[]> {
  const rows = await prisma.$queryRaw<StuckTask[]>`
    SELECT t.id::text AS id, t.agent_key, t.company_id, c.name AS company_name,
           t.attempts::int AS attempts, t.max_attempts::int AS max_attempts,
           (t.lease_until < now()) AS lease_expired,
           greatest(lr.started_at, le.at) AS last_progress_at
    FROM public.agent_tasks t
    LEFT JOIN public.companies c ON c.id = t.company_id
    LEFT JOIN LATERAL (
      SELECT r.started_at FROM public.agent_runs r WHERE r.task_id = t.id ORDER BY r.started_at DESC LIMIT 1
    ) lr ON TRUE
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS at FROM public.agent_events e WHERE e.task_id = t.id
    ) le ON TRUE
    WHERE t.status = 'running'
      AND (t.lease_until < now()
           OR (lr.started_at IS NOT NULL
               AND greatest(lr.started_at, le.at) < now() - make_interval(mins => ${minutes}::int)))
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_events n WHERE n.dedupe_key = 'agent:' || t.id::text || ':stuck'
      )
    ORDER BY t.lease_until
    LIMIT 20`
  return rows.map((r) => ({ ...r, attempts: Number(r.attempts), max_attempts: Number(r.max_attempts) }))
}

/**
 * Stuck-task signal (queue maintenance, before the reaper recovers expired
 * leases): one CRITICAL per task. Returns the number of tasks reported.
 */
export async function alertStuckTasks(deps: NotifyDeps = {}): Promise<number> {
  const notify = withAgentsTelegramLevel(deps.notify ?? notifyStaff)
  if (!(await automationEnabled('agents_stuck_alerts'))) return 0
  const minutes = await automationSetting('agents_stuck_minutes')
  const stuck = await findStuckTasks(minutes)
  const now = deps.now ?? new Date()
  let reported = 0
  for (const t of stuck) {
    const idle = t.last_progress_at ? Math.max(minutes, Math.floor((now.getTime() - new Date(t.last_progress_at).getTime()) / 60_000)) : minutes
    const res = await notify(lifecycleNotification({
      kind: 'stuck',
      taskId: t.id,
      agentKey: t.agent_key,
      agentName: agentName(t.agent_key),
      companyId: t.company_id,
      companyName: t.company_name,
      attempt: t.attempts,
      maxAttempts: t.max_attempts,
      leaseExpired: t.lease_expired,
      idleMinutes: idle,
    }))
    if (!res.duplicate) reported += 1
  }
  return reported
}

/** Run a notifier without ever breaking the queue. */
export async function safely<T>(label: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work()
  } catch (err) {
    console.error(`[agents/lifecycle] ${label} failed:`, err instanceof Error ? err.message.split('\n')[0] : err)
    return null
  }
}
