/**
 * lib/ops/job-watchdog.ts — сторож плановых задач (R4-A1: N4A-3, N4A-7, N4A-15, R-051), по образцу
 * сторожа бэкапов (lib/ops/backup-freshness.ts). Крон портала /api/cron/ops-watchdog раз в 10 минут:
 *
 *   • задачи по расписанию — журнал public.ops_job_runs (миграция 154) против расписания:
 *       крон портала и агентов (lib/cron/schedule.ts CRON_JOBS, по ролям этого развёртывания) и
 *       функции Inngest по расписанию (lib/functions/registry.ts), включая синтетический пинг
 *       ops-ping каждые 10 минут (сервер Inngest → портал → база);
 *       «не запускалась»  последний запуск старше max(2 × интервал, интервал + 15 мин)
 *                         → CRITICAL для частых задач (интервал ≤ 15 мин), иначе WARNING;
 *       «ни разу»         то же для задачи, которой нет в журнале, когда её ждут дольше этого срока —
 *                         с первого прохода сторожа, в котором она появилась в расписании
 *                         (ops_job_expectations), а не с начала журнала: новая задача в новом
 *                         выпуске не даёт ложной тревоги;
 *       «падает»          последний исход редкой задачи (интервал ≥ 1 ч) или три последних частой —
 *                         не ok → WARNING. claim_failed (задача не вызывалась) сюда не входит: о нём
 *                         кричит сам планировщик (lib/cron/runner.ts, N4A-4);
 *   • очередь пересчёта Точки А (point_a_recalc_queue): только ПРОСРОЧЕННЫЕ строки — срок прошёл
 *     больше часа назад и строку сейчас никто не разбирает → WARNING, самая старая > 6 ч → CRITICAL.
 *     Глубина сама по себе не тревога: ночной проход (point-a-nightly, kick: false) законно кладёт
 *     всех клиентов в очередь со сроками на ближайший час, и крон агентов разбирает её раз в минуту;
 *   • проверки мониторинг-агента без ИИ (platformHealthSnapshot: очередь агентов старше 15 мин,
 *     зависшие и dead-задачи, документы, одобрения, CRM, расход ИИ) — теперь не зависят от
 *     тумблера «Агенты 24/7» (N4A-7); warn → WARNING, critical → CRITICAL;
 *   • демо-аккаунты (R-051): создано за сутки > 20 → WARNING; есть старше 48 ч (очистка не идёт) → WARNING;
 *   • сервис агентов (портал с PORTAL_ROLE=web): GET {AGENTS_SERVICE_URL}/api/healthz не прошёл в
 *     двух проходах подряд → CRITICAL (один перезапуск сервиса — не тревога);
 *   • «тревогам некуда приходить»: ни один Super Admin (право settings.manage — только им уходят
 *     тревоги сторожа) не привязал Telegram, и тревоге без базы некуда уйти (нет
 *     TELEGRAM_ADMIN_CHAT_IDS или токена бота) → WARNING в ленте ГИГА (напоминание раз в сутки).
 *
 * Уведомление — notifyStaff (лента ГИГА + Telegram персонала + письмо для CRITICAL), только Super
 * Admin (settings.manage). Об одной проблеме (ключ) — не чаще раза в 6 ч (последнее событие
 * ops.watchdog с этим ключом), ключ dedupe ещё и привязан к окну, как у бэкапа. Если сам сторож не
 * может прочитать базу два прохода подряд — тревога напрямую в Telegram
 * (lib/notifications/ops-direct.ts), без базы. Сбой отправки одной тревоги не обрывает проход:
 * остальные тревоги и чистка выполняются, сбой — в failedChecks.
 *
 * Ретенция (N4A-15): за проход удаляются строки ops_job_runs старше 30 дней, кроме последнего
 * исхода каждой задачи (месячная задача с допуском 62 дня не теряет свой последний запуск), и
 * строки cron_runs (workflow-db) старше 30 дней — не больше 20 000 за раз.
 */
import { Cron } from 'croner'
import { prisma } from '@/lib/db'
import { CRON_JOBS, jobsForRole, type CronJob } from '@/lib/cron/schedule'
import { hasPermission, isStaffRole } from '@/lib/admin/rbac'
import { opsAlertChatIds, opsDirectConfigured, sendOpsDirect } from '@/lib/notifications/ops-direct'
import { inngestJobName, type JobStatus } from '@/lib/ops/job-journal'
import { agentsServiceUrl, portalRole, type PortalRole } from '@/lib/runtime/role'

export const WATCHDOG_EVENT_TYPE = 'ops.watchdog'
/** Who gets the watchdog's alarms in Telegram (notifyStaff audience): settings.manage = Super Admin. */
export const WATCHDOG_AUDIENCE = 'settings.manage' as const
export const WATCHDOG_REMIND_HOURS = 6
/** «Тревогам некуда приходить» — напоминание раз в сутки, а не каждые 6 ч. */
export const NOWHERE_REMIND_HOURS = 24
export const JOURNAL_RETENTION_DAYS = 30
export const DEMO_DAILY_WARN = 20
export const PA_QUEUE_WARN_MINUTES = 60
export const PA_QUEUE_CRITICAL_MINUTES = 6 * 60
/** A job this frequent that stops is the scheduler or Inngest itself: CRITICAL. */
const FREQUENT_MS = 15 * 60_000
const GRACE_MS = 15 * 60_000
const HOUR_MS = 3600_000
const PRUNE_BATCH = 20_000

type Env = Partial<NodeJS.ProcessEnv>
export type Level = 'CRITICAL' | 'WARNING'

export interface WatchProblem {
  /** Ключ проблемы: по нему считаются повторы. */
  key: string
  level: Level
  title: string
  lines: string[]
}

// ─── Расписание: какие задачи ждать и как часто ──────────────────────────────

export interface ExpectedJob {
  /** '/api/cron/…' or 'inngest:<function id>'. */
  job: string
  kind: 'cron' | 'inngest'
  schedule: string
  /** Longest gap between two firings of the schedule. */
  gapMs: number
  /** How old the last run may be before the job counts as stopped. */
  allowedMs: number
}

/** 'TZ=Asia/Almaty 30 4 * * *' → the pattern and the zone (Inngest cron syntax); plain patterns are UTC. */
export function parseSchedule(expr: string): { pattern: string; timezone: string } {
  const m = /^\s*TZ=(\S+)\s+(.+)$/.exec(expr)
  return m ? { pattern: m[2].trim(), timezone: m[1] } : { pattern: expr.trim(), timezone: 'UTC' }
}

const gapCache = new Map<string, number>()
/** A fixed Monday, so the result does not depend on when it is computed. */
const GAP_FROM = new Date('2026-01-05T00:00:00Z')

/** The longest gap between consecutive firings of `expr`, over its next 400 firings. */
export function maxGapMs(expr: string): number {
  const cached = gapCache.get(expr)
  if (cached !== undefined) return cached
  const { pattern, timezone } = parseSchedule(expr)
  const runs = new Cron(pattern, { timezone, paused: true }).nextRuns(400, GAP_FROM)
  let gap = 0
  for (let i = 1; i < runs.length; i += 1) gap = Math.max(gap, runs[i].getTime() - runs[i - 1].getTime())
  // A schedule that fires once (or never) in the sample: treat it as a year apart, i.e. never stale.
  if (gap === 0) gap = 365 * 24 * HOUR_MS
  gapCache.set(expr, gap)
  return gap
}

/** The interval × 2, and never less than the interval plus 15 minutes (a missed minute at a redeploy is not an alarm). */
export function allowedStalenessMs(gapMs: number): number {
  return Math.max(2 * gapMs, gapMs + GRACE_MS)
}

export interface InngestCron {
  id: string
  cron: string
}

/**
 * What this deployment runs on schedule, seen from the portal: one process for everything runs the
 * jobs of 'all'; a split portal expects its own jobs and those of the agents service. The Inngest
 * functions are those this process serves (none on the agents service).
 */
export function expectedJobs(role: PortalRole, inngestCrons: readonly InngestCron[], jobs: readonly CronJob[] = CRON_JOBS): ExpectedJob[] {
  const crons = role === 'all' ? jobsForRole('all', jobs) : [...jobsForRole('web', jobs), ...jobsForRole('agents', jobs)]
  const expected: ExpectedJob[] = crons.map((j) => {
    const gapMs = maxGapMs(j.schedule)
    return { job: j.path, kind: 'cron', schedule: j.schedule, gapMs, allowedMs: allowedStalenessMs(gapMs) }
  })
  for (const fn of inngestCrons) {
    const gapMs = maxGapMs(fn.cron)
    expected.push({ job: inngestJobName(fn.id), kind: 'inngest', schedule: fn.cron, gapMs, allowedMs: allowedStalenessMs(gapMs) })
  }
  return expected
}

const JOB_LABELS: Record<string, string> = {
  '/api/cron/billing-expiry': 'окончание тарифов',
  '/api/cron/staff-digest': 'сводка персоналу',
  '/api/cron/crm-digest': 'сводка CRM',
  '/api/cron/agents-digest': 'сводка агентов',
  '/api/cron/client-digest': 'сводка клиентам',
  '/api/telegram/personal/sync': 'синхронизация личного Telegram',
  '/api/cron/reminders': 'напоминания',
  '/api/cron/analytics-rollup': 'сводка аналитики',
  '/api/cron/ai-discovery': 'обнаружение моделей ИИ',
  '/api/cron/backup-freshness': 'сторож бэкапов',
  '/api/cron/expert-sla': 'SLA экспертов',
  '/api/cron/access-requests': 'срок заявок на оплату',
  '/api/cron/ops-watchdog': 'сторож задач',
  '/api/cron/ops-crosswatch': 'перекрёстный сторож',
  '/api/cron/agents': 'обслуживание очереди агентов',
  'inngest:ops-ping': 'пинг Inngest (сервер Inngest вызывает портал)',
  'inngest:point-a-nightly': 'ночной пересчёт Точки А',
  'inngest:pb-recompute': 'пересчёт Точки Б',
  'inngest:pb-monthly-checkpoint': 'месячная сверка Точки Б',
  'inngest:pb-invite-external': 'приглашения Точки Б',
  'inngest:comm-escalations': 'правило 30 минут в «Сообщениях»',
  'inngest:comm-campaign-watchdog': 'сторож рассылок',
  'inngest:demo-accounts-cleanup': 'очистка демо-аккаунтов',
  'inngest:assistant-events-retention': 'ретенция событий ассистента',
  'inngest:omnichannel-maintenance': 'обслуживание омниканала',
  'inngest:omnichannel-outbound-delivery-maintenance': 'доставка исходящих омниканала',
  'inngest:agents-maintenance': 'обслуживание очереди агентов (Inngest)',
}

export function jobLabel(job: string): string {
  const label = JOB_LABELS[job]
  return label ? `«${label}» (${job})` : job
}

// ─── Журнал → состояние задач ────────────────────────────────────────────────

export interface JobRunRow {
  job: string
  status: JobStatus
  finishedAt: Date
  httpStatus: number | null
  error: string | null
}

export interface JobsState {
  expected: ExpectedJob[]
  /** The last outcome of each job that was actually called (claim_failed left out). */
  last: Map<string, JobRunRow>
  /** Up to three latest statuses of each job, newest first (claim_failed left out). */
  recent: Map<string, JobStatus[]>
  /** Since when each job has been expected (ops_job_expectations); a job without one is new. */
  expectedSince: Map<string, Date>
}

export type JobHealth = 'ok' | 'stale' | 'never' | 'failing' | 'waiting'

export interface JobView {
  job: string
  label: string
  kind: 'cron' | 'inngest'
  schedule: string
  lastAt: string | null
  lastStatus: JobStatus | null
  health: JobHealth
  allowedMinutes: number
}

function almaty(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 120) return `${minutes} мин`
  const hours = Math.round(minutes / 60)
  return hours < 72 ? `${hours} ч` : `${Math.round(hours / 24)} дн`
}

const STATUS_RU: Record<JobStatus, string> = {
  ok: 'успешно',
  http_error: 'ответ с ошибкой',
  error: 'сбой вызова',
  timeout: 'нет ответа за 300 с',
  claim_failed: 'не запущена (захват не удался)',
}

/** The state of every expected job and the problems among them. Pure: the caller loads the journal. */
export function assessJobs(s: JobsState, now: Date): { views: JobView[]; problems: WatchProblem[] } {
  const views: JobView[] = []
  const problems: WatchProblem[] = []
  for (const e of s.expected) {
    const last = s.last.get(e.job) ?? null
    const recent = s.recent.get(e.job) ?? []
    const level: Level = e.gapMs <= FREQUENT_MS ? 'CRITICAL' : 'WARNING'
    let health: JobHealth = 'ok'
    if (!last) {
      const since = s.expectedSince.get(e.job) ?? null
      const waited = since ? now.getTime() - since.getTime() : 0
      health = waited > e.allowedMs ? 'never' : 'waiting'
      if (health === 'never') {
        problems.push({
          key: `job:never:${e.job}`,
          level,
          title: 'Задача по расписанию ни разу не запускалась',
          lines: [
            `${jobLabel(e.job)}, расписание «${e.schedule}» (UTC, если не указано иное).`,
            `Её ждут с ${almaty(since!)} (Алматы), ${ago(waited)}, — и ни одного запуска в журнале.`,
            e.kind === 'inngest'
              ? 'Проверьте сервис inngest в Railway и синхронизацию функций (PUT /api/inngest).'
              : 'Проверьте планировщик сервиса (CRON_RUNNER_ENABLED, CRON_SECRET) и его логи.',
          ],
        })
      }
    } else if (now.getTime() - last.finishedAt.getTime() > e.allowedMs) {
      health = 'stale'
      problems.push({
        key: `job:stale:${e.job}`,
        level,
        title: 'Задача по расписанию давно не запускалась',
        lines: [
          `${jobLabel(e.job)}, расписание «${e.schedule}».`,
          `Последний запуск: ${almaty(last.finishedAt)} (Алматы), ${ago(now.getTime() - last.finishedAt.getTime())} назад — ${STATUS_RU[last.status]}.`,
          `Допустимо не дольше ${ago(e.allowedMs)}.`,
          e.kind === 'inngest'
            ? 'Проверьте сервис inngest в Railway и синхронизацию функций (PUT /api/inngest).'
            : 'Проверьте планировщик сервиса и workflow-db (захват минут).',
        ],
      })
    } else {
      // A rare job: its last outcome, however old (the journal keeps it). A frequent one: the last
      // three of the past days.
      const failing = e.gapMs >= HOUR_MS
        ? last.status !== 'ok'
        : recent.length >= 3 && recent.slice(0, 3).every((st) => st !== 'ok')
      if (failing) {
        health = 'failing'
        problems.push({
          key: `job:failing:${e.job}`,
          level: 'WARNING',
          title: 'Задача по расписанию завершается ошибкой',
          lines: [
            `${jobLabel(e.job)}: ${e.gapMs >= HOUR_MS ? 'последний запуск' : 'три последних запуска'} — не успешно.`,
            `Последний: ${almaty(last.finishedAt)} (Алматы) — ${STATUS_RU[last.status]}${last.httpStatus ? ` (HTTP ${last.httpStatus})` : ''}${last.error ? `: ${last.error}` : ''}.`,
            'Подробности — в логах сервиса за это время.',
          ],
        })
      }
    }
    views.push({
      job: e.job,
      label: JOB_LABELS[e.job] ?? e.job,
      kind: e.kind,
      schedule: e.schedule,
      lastAt: last ? last.finishedAt.toISOString() : null,
      lastStatus: last?.status ?? null,
      health,
      allowedMinutes: Math.round(e.allowedMs / 60_000),
    })
  }
  return { views, problems }
}

// ─── Остальные проверки ─────────────────────────────────────────────────────

export interface PointAQueueState {
  /** Rows whose due time has passed (the whole due depth, for the message only). */
  due: number
  /** Rows overdue by more than PA_QUEUE_WARN_MINUTES that nobody is working on now. */
  overdue: number
  /** Minutes since the due time of the oldest overdue row; null when none is overdue. */
  oldestOverdueMinutes: number | null
}

/** Only rows past their due time by more than an hour count; the depth of the nightly wave does not. */
export function assessPointAQueue(q: PointAQueueState): WatchProblem[] {
  if (q.overdue === 0 || q.oldestOverdueMinutes === null || q.oldestOverdueMinutes < PA_QUEUE_WARN_MINUTES) return []
  return [{
    key: 'pa_queue:overdue',
    level: q.oldestOverdueMinutes >= PA_QUEUE_CRITICAL_MINUTES ? 'CRITICAL' : 'WARNING',
    title: 'Очередь пересчёта Точки А не разбирается',
    lines: [
      `Просрочено больше чем на ${PA_QUEUE_WARN_MINUTES} мин: ${q.overdue} (всего ждут: ${q.due}); самый старый срок прошёл ${ago(q.oldestOverdueMinutes * 60_000)} назад.`,
      'Очередь разбирает крон сервиса агентов (/api/cron/agents) каждую минуту и функция Inngest point-a-recalc — проверьте оба.',
    ],
  }]
}

export interface HealthCheckLike {
  key: string
  label: string
  status: 'ok' | 'warn' | 'critical'
  value: number
  detail: string
}

export function assessPlatform(checks: readonly HealthCheckLike[]): WatchProblem[] {
  return checks
    .filter((c) => c.status !== 'ok')
    .map((c) => ({
      key: `platform:${c.key}`,
      level: c.status === 'critical' ? 'CRITICAL' : 'WARNING',
      title: `Платформа: ${c.label}`,
      lines: [`Значение: ${c.value} (${c.detail}).`, 'Подробности — ГИГА → Настройки → «Состояние системы».'],
    }))
}

export interface DemoState {
  created24h: number
  olderThan48h: number
}

export function assessDemo(d: DemoState, dailyWarn = DEMO_DAILY_WARN): WatchProblem[] {
  const problems: WatchProblem[] = []
  if (d.created24h > dailyWarn) {
    problems.push({
      key: 'demo:burst',
      level: 'WARNING',
      title: 'Много демо-аккаунтов за сутки',
      lines: [
        `Создано за 24 ч: ${d.created24h} (порог ${dailyWarn}). Демо-аккаунт сразу одобрен.`,
        'Если это не запланировано — выключите демо-доступ (DEMO_ACCESS_ENABLED=false или режим регистрации «по приглашению»).',
      ],
    })
  }
  if (d.olderThan48h > 0) {
    problems.push({
      key: 'demo:stale',
      level: 'WARNING',
      title: 'Демо-аккаунты не удаляются',
      lines: [
        `Демо-аккаунтов старше 48 ч: ${d.olderThan48h}. Их удаляет функция Inngest demo-accounts-cleanup раз в сутки — похоже, она не работает.`,
      ],
    })
  }
  return problems
}

export interface AlertRoutes {
  /**
   * Approved staff with a linked Telegram chat who RECEIVE the watchdog's alarms: their role has
   * settings.manage (the audience of the alarms; only Super Admin) — the same rule notifyStaff
   * applies to its targets. An expert or an Admin with Telegram does not count.
   */
  linkedStaff: number
  /** Chats of TELEGRAM_ADMIN_CHAT_IDS. */
  envChats: number
  /** The alarm without the database (ops-direct) can reach someone: chats AND a bot token. */
  direct: boolean
}

/** Telegram has nobody to tell: no linked Super Admin, and no env chat that a bot token can reach. */
export function alertsGoNowhere(r: AlertRoutes): boolean {
  return r.linkedStaff === 0 && !r.direct
}

export function assessAlertRoutes(r: AlertRoutes): WatchProblem[] {
  if (!alertsGoNowhere(r)) return []
  return [{
    key: 'alerts:nowhere',
    level: 'WARNING',
    title: 'Тревогам некуда приходить',
    lines: [
      'Ни один Super Admin не привязал Telegram, и TELEGRAM_ADMIN_CHAT_IDS не задан (или у бота нет токена): тревоги о сбоях видны только в этой ленте.',
      'Тревоги, которым не нужна база (не работают кроны, портал или база недоступны), не уходят никуда, кроме логов.',
      'Привязать: ГИГА → «Уведомления» → «Привязать Telegram»; для тревог без базы — задать TELEGRAM_ADMIN_CHAT_IDS.',
    ],
  }]
}

// ─── Проход ──────────────────────────────────────────────────────────────────

export interface WatchdogDeps {
  role(): PortalRole
  /** Scheduled Inngest functions this process serves (id + cron). */
  inngestCrons(): Promise<InngestCron[]>
  /** null — journal table missing (migration 154 not applied). */
  loadJobs(expected: ExpectedJob[]): Promise<JobsState | null>
  pointAQueue(): Promise<PointAQueueState>
  platformChecks(): Promise<HealthCheckLike[]>
  demo(): Promise<DemoState>
  alertRoutes(): Promise<AlertRoutes>
  /** GET {AGENTS_SERVICE_URL}/api/healthz from the portal; null when not split / not configured. */
  agentsService(): Promise<{ ok: boolean; detail: string } | null>
  /** Deletes journal rows older than JOURNAL_RETENTION_DAYS; counts per journal (null — not available). */
  prune(): Promise<{ jobRuns: number | null; cronRuns: number | null }>
  lastAlertAt(key: string): Promise<Date | null>
  notify(problem: WatchProblem, now: Date, remindHours: number): Promise<{ sent: boolean }>
  /** The alarm without the database, for when the watchdog itself cannot read it. */
  alertDirect(problem: WatchProblem): Promise<unknown>
}

export interface WatchdogReport {
  /**
   * ok — проблем нет; alerted — что-то отправлено; quiet — проблемы есть, но о них уже сказали;
   * undelivered — хотя бы одну тревогу не удалось отправить (NV-4): маршрут отвечает
   * WATCHDOG_UNDELIVERED_HTTP, журнал задач и ГИГА это видят.
   */
  status: 'ok' | 'alerted' | 'quiet' | 'undelivered'
  journal: 'ok' | 'not_migrated'
  problems: string[]
  notified: string[]
  /** Problems whose alert could not be sent (the feed or the delivery failed). */
  undelivered: string[]
  /** Checks that could not run (their own failure is a problem too). */
  failedChecks: string[]
  pruned: { jobRuns: number | null; cronRuns: number | null }
}

/**
 * The HTTP status of /api/cron/ops-watchdog when an alert could not be sent (R4-A1 verify NV-4): the
 * runner journals it as http_error with this code, and the GIGA card shows «тревоги не доставлены».
 */
export const WATCHDOG_UNDELIVERED_HTTP = 502

const remindHoursOf = (key: string) => (key === 'alerts:nowhere' ? NOWHERE_REMIND_HOURS : WATCHDOG_REMIND_HOURS)

/**
 * A single failed probe is not an outage (a service restarting, one pool timeout): the CRITICAL of
 * «agents:down» and «watchdog:db» needs this many passes in a row (10 minutes apart).
 */
export const ALERT_AFTER_FAILURES = 2
const STREAK_KEY = Symbol.for('aistart360.ops.watchdog.streaks')
function streaks(): Map<string, number> {
  const g = globalThis as Record<symbol, Map<string, number> | undefined>
  return (g[STREAK_KEY] ??= new Map())
}
/** Consecutive passes in which `key` failed, this one included; a pass that did not fail resets it. */
export function failureStreak(key: string, failed: boolean): number {
  const map = streaks()
  if (!failed) {
    map.delete(key)
    return 0
  }
  const n = (map.get(key) ?? 0) + 1
  map.set(key, n)
  return n
}
/** For tests: forget the streaks of earlier passes. */
export function resetWatchdogStreaks(): void {
  streaks().clear()
}

function isMissingTable(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null
  if (err?.code === '42P01' || err?.meta?.code === '42P01') return true
  return typeof err?.message === 'string' && /does not exist/.test(err.message) && /relation|table/i.test(err.message)
}

const shortMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200)

export async function runJobWatchdog(now: Date = new Date(), deps: WatchdogDeps = defaultDeps): Promise<WatchdogReport> {
  const role = deps.role()
  const failedChecks: string[] = []
  const problems: WatchProblem[] = []

  // 1. Jobs against the journal. A database that cannot be read at all is said directly (no DB needed).
  let journal: WatchdogReport['journal'] = 'ok'
  let crons: InngestCron[] = []
  try {
    crons = await deps.inngestCrons()
  } catch (e) {
    failedChecks.push('inngest_schedule')
    console.error('[ops-watchdog] inngest schedule unavailable:', shortMessage(e))
  }
  const expected = expectedJobs(role, crons)
  try {
    const state = await deps.loadJobs(expected)
    failureStreak('watchdog:db', false)
    if (state) problems.push(...assessJobs(state, now).problems)
    else journal = 'not_migrated'
  } catch (e) {
    if (isMissingTable(e)) {
      failureStreak('watchdog:db', false)
      journal = 'not_migrated'
    } else {
      // The second pass in a row that cannot read the database: the alarm without it.
      if (failureStreak('watchdog:db', true) >= ALERT_AFTER_FAILURES) {
        const problem: WatchProblem = {
          key: 'watchdog:db',
          level: 'CRITICAL',
          title: 'Сторож задач не может прочитать базу',
          lines: [`Ошибка: ${shortMessage(e)}`, `Уже ${ALERT_AFTER_FAILURES} прохода подряд (раз в 10 минут).`, 'Проверьте базу данных (Postgres) и её подключения.'],
        }
        try {
          await deps.alertDirect(problem)
        } catch (alarmError) {
          console.error('[ops-watchdog] direct alarm failed:', shortMessage(alarmError))
        }
      }
      throw e
    }
  }

  // 2. The other checks: each on its own; one that fails does not hide the rest.
  const checks: Array<[string, () => Promise<WatchProblem[]>]> = [
    ['point_a_queue', async () => assessPointAQueue(await deps.pointAQueue())],
    ['platform', async () => assessPlatform(await deps.platformChecks())],
    ['demo', async () => assessDemo(await deps.demo())],
    ['alert_routes', async () => assessAlertRoutes(await deps.alertRoutes())],
    ['agents_service', async () => {
      const res = await deps.agentsService()
      // One failed probe may be the service restarting: the alarm needs two passes in a row.
      const streak = failureStreak('agents:down', res !== null && !res.ok)
      if (!res || res.ok || streak < ALERT_AFTER_FAILURES) return []
      return [{
        key: 'agents:down',
        level: 'CRITICAL' as const,
        title: 'Сервис агентов не отвечает порталу',
        lines: [
          `GET /api/healthz по AGENTS_SERVICE_URL: ${res.detail}; проходов сторожа подряд: ${streak} (раз в 10 минут).`,
          'Задачи агентов ждут в очереди; проверьте сервис agents в Railway.',
        ],
      }]
    }],
  ]
  for (const [name, run] of checks) {
    try {
      problems.push(...(await run()))
    } catch (e) {
      if (isMissingTable(e)) continue // the feature behind it is not migrated here: nothing to watch
      failedChecks.push(name)
      console.error(`[ops-watchdog] check ${name} failed:`, shortMessage(e))
    }
  }

  // 3. Alerts, at most once per key and window. One that cannot be sent (the database wobbles)
  // is named and does not keep the others — CRITICAL among them — or the retention from going.
  const notified: string[] = []
  const undelivered: WatchProblem[] = []
  for (const p of problems) {
    try {
      const remind = remindHoursOf(p.key)
      const last = await deps.lastAlertAt(p.key)
      if (last && now.getTime() - last.getTime() < remind * HOUR_MS) continue
      const res = await deps.notify(p, now, remind)
      if (res.sent) notified.push(p.key)
    } catch (e) {
      failedChecks.push(`notify:${p.key}`)
      undelivered.push(p)
      console.error(`[ops-watchdog] alert ${p.key} not sent:`, shortMessage(e))
    }
  }
  // Alerts that could not go through the feed: at least the alarm without the database (its own
  // limit: once per 6 h per process), and the pass says so (NV-4) — never a quiet «ok».
  if (undelivered.length > 0) {
    try {
      await deps.alertDirect({
        key: 'watchdog:undelivered',
        level: undelivered.some((p) => p.level === 'CRITICAL') ? 'CRITICAL' : 'WARNING',
        title: 'Сторож задач не смог отправить тревоги',
        lines: [
          `Не отправлено: ${undelivered.length} (${undelivered.slice(0, 5).map((p) => p.title).join('; ')}${undelivered.length > 5 ? '; …' : ''}).`,
          'Запись в ленту уведомлений не прошла — проверьте базу данных; подробности в логе портала.',
        ],
      })
    } catch (alarmError) {
      console.error('[ops-watchdog] direct alarm failed:', shortMessage(alarmError))
    }
  }

  // 4. Retention (N4A-15). Never fails the pass.
  let pruned: WatchdogReport['pruned'] = { jobRuns: null, cronRuns: null }
  try {
    pruned = await deps.prune()
  } catch (e) {
    failedChecks.push('retention')
    console.error('[ops-watchdog] retention failed:', shortMessage(e))
  }

  return {
    status: undelivered.length > 0 ? 'undelivered' : problems.length === 0 ? 'ok' : notified.length > 0 ? 'alerted' : 'quiet',
    journal,
    problems: problems.map((p) => p.key),
    notified,
    undelivered: undelivered.map((p) => p.key),
    failedChecks,
    pruned,
  }
}

// ─── База и рассылка по умолчанию ────────────────────────────────────────────

/** A job not expected for longer than this (switched off, another role) starts its «never» count anew. */
const EXPECTATION_RESET = '1 day'

/**
 * The journal as the watchdog and the GIGA card read it. null — the table does not exist here.
 * With `recordExpectations` (the watchdog, not the GIGA card) every expected job is first noted in
 * ops_job_expectations: the first pass that expects a job starts its «never» count.
 */
export async function loadJobsState(expected: ExpectedJob[], opts: { recordExpectations?: boolean } = {}): Promise<JobsState | null> {
  const [exists] = await prisma.$queryRaw<Array<{ t: string | null; e: string | null }>>`
    SELECT to_regclass('public.ops_job_runs')::text AS t, to_regclass('public.ops_job_expectations')::text AS e`
  if (!exists?.t) return null
  const jobs = expected.map((e) => e.job)
  if (opts.recordExpectations && exists.e && jobs.length > 0) {
    await prisma.$executeRaw`
      INSERT INTO public.ops_job_expectations (job, first_expected_at, last_expected_at)
      SELECT j, now(), now() FROM unnest(${jobs}::text[]) AS j
      ON CONFLICT (job) DO UPDATE SET
        first_expected_at = CASE
          WHEN public.ops_job_expectations.last_expected_at < now() - ${EXPECTATION_RESET}::interval THEN now()
          ELSE public.ops_job_expectations.first_expected_at END,
        last_expected_at = now()`
  }
  const [lastRows, recentRows, expectations] = await Promise.all([
    prisma.$queryRaw<Array<{ job: string; status: JobStatus; finished_at: Date; http_status: number | null; error: string | null }>>`
      SELECT DISTINCT ON (job) job, status, finished_at, http_status, error
        FROM public.ops_job_runs
       WHERE status <> 'claim_failed'
       ORDER BY job, finished_at DESC`,
    prisma.$queryRaw<Array<{ job: string; statuses: JobStatus[] }>>`
      SELECT job, array_agg(status ORDER BY finished_at DESC) AS statuses
        FROM (SELECT job, status, finished_at,
                     row_number() OVER (PARTITION BY job ORDER BY finished_at DESC) AS rn
                FROM public.ops_job_runs
               WHERE status <> 'claim_failed' AND finished_at > now() - interval '8 days') t
       WHERE rn <= 3
       GROUP BY job`,
    exists.e
      ? prisma.$queryRaw<Array<{ job: string; first_expected_at: Date }>>`
          SELECT job, first_expected_at FROM public.ops_job_expectations WHERE job = ANY (${jobs}::text[])`
      : Promise.resolve([] as Array<{ job: string; first_expected_at: Date }>),
  ])
  return {
    expected,
    last: new Map(lastRows.map((r) => [r.job, { job: r.job, status: r.status, finishedAt: r.finished_at, httpStatus: r.http_status, error: r.error }])),
    recent: new Map(recentRows.map((r) => [r.job, r.statuses])),
    expectedSince: new Map(expectations.map((r) => [r.job, r.first_expected_at])),
  }
}

/** A claim younger than this is a recalculation in progress (lib/point-a/recalc-queue.ts STALE_CLAIM_MINUTES). */
const PA_CLAIM_ACTIVE_MINUTES = 10

async function pointAQueue(): Promise<PointAQueueState> {
  const [r] = await prisma.$queryRaw<Array<{ due: bigint; overdue: bigint; oldest: Date | null }>>`
    SELECT count(*) AS due,
           count(*) FILTER (WHERE due_at < now() - make_interval(mins => ${PA_QUEUE_WARN_MINUTES}::int)
                              AND (started_at IS NULL OR started_at < now() - make_interval(mins => ${PA_CLAIM_ACTIVE_MINUTES}::int))) AS overdue,
           min(due_at) FILTER (WHERE due_at < now() - make_interval(mins => ${PA_QUEUE_WARN_MINUTES}::int)
                              AND (started_at IS NULL OR started_at < now() - make_interval(mins => ${PA_CLAIM_ACTIVE_MINUTES}::int))) AS oldest
      FROM public.point_a_recalc_queue
     WHERE due_at <= now()`
  return {
    due: Number(r?.due ?? 0),
    overdue: Number(r?.overdue ?? 0),
    oldestOverdueMinutes: r?.oldest ? Math.floor((Date.now() - r.oldest.getTime()) / 60_000) : null,
  }
}

async function demo(): Promise<DemoState> {
  const [r] = await prisma.$queryRaw<Array<{ created: bigint; old: bigint }>>`
    SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS created,
           count(*) FILTER (WHERE created_at < now() - interval '48 hours') AS old
      FROM auth.users
     WHERE raw_app_meta_data->>'demo' = 'true' AND email LIKE 'demo-%@aistart360.app'`
  return { created24h: Number(r?.created ?? 0), olderThan48h: Number(r?.old ?? 0) }
}

/**
 * Who the watchdog's alarms reach in Telegram: linked staff as notifyStaff selects them
 * (lib/notifications/staff.ts linkedStaff — approved profile, a role from staff_roles) and, among
 * them, only those whose role has the alarms' audience permission (settings.manage); plus the env
 * chats and whether a bot token can reach them.
 */
export async function loadAlertRoutes(env: Env = process.env, db: Pick<typeof prisma, '$queryRaw'> = prisma): Promise<AlertRoutes> {
  const rows = await db.$queryRaw<Array<{ role: string | null }>>`
    SELECT s.role
      FROM public.staff_telegram_links l
      JOIN public.profiles p ON p.id = l.user_id AND p.status = 'approved'
      JOIN public.staff_roles s ON s.user_id = l.user_id
     WHERE l.linked_at IS NOT NULL AND l.chat_id IS NOT NULL`
  const linkedStaff = rows.filter((r) => isStaffRole(r.role) && hasPermission(r.role, WATCHDOG_AUDIENCE)).length
  return { linkedStaff, envChats: opsAlertChatIds(env).length, direct: opsDirectConfigured(env) }
}

async function agentsService(): Promise<{ ok: boolean; detail: string } | null> {
  if (portalRole() !== 'web') return null
  const base = agentsServiceUrl()
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/healthz`, { signal: AbortSignal.timeout(5_000), cache: 'no-store' })
    try { await res.body?.cancel() } catch { /* closed */ }
    return res.ok ? { ok: true, detail: `HTTP ${res.status}` } : { ok: false, detail: `HTTP ${res.status}` }
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name
    return { ok: false, detail: name === 'TimeoutError' ? 'нет ответа за 5 с' : `нет соединения (${shortMessage(e)})` }
  }
}

async function prune(): Promise<{ jobRuns: number | null; cronRuns: number | null }> {
  let jobRuns: number | null = null
  try {
    // Older than 30 days goes — except the last outcome of every job (a later call of the same job
    // exists): a monthly job, allowed 62 days, keeps its last run, and so does a job that stopped.
    // Old claim failures go in any case: they are never «the last run».
    jobRuns = await prisma.$executeRaw`
      DELETE FROM public.ops_job_runs
       WHERE id IN (SELECT r.id FROM public.ops_job_runs r
                     WHERE r.finished_at < now() - make_interval(days => ${JOURNAL_RETENTION_DAYS}::int)
                       AND (r.status = 'claim_failed'
                            OR EXISTS (SELECT 1 FROM public.ops_job_runs n
                                        WHERE n.job = r.job AND n.status <> 'claim_failed' AND n.finished_at > r.finished_at))
                     LIMIT ${PRUNE_BATCH}::int)`
  } catch (e) {
    if (!isMissingTable(e)) throw e
  }
  const workflowUrl = process.env.WORKFLOW_POSTGRES_URL?.trim()
  const { pruneCronRuns } = await import('@/lib/cron/claim')
  const cronRuns = workflowUrl ? await pruneCronRuns(workflowUrl, JOURNAL_RETENTION_DAYS, PRUNE_BATCH) : null
  return { jobRuns, cronRuns }
}

async function lastAlertAt(key: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ at: Date | null }>>`
    SELECT max(created_at) AS at FROM public.notification_events
    WHERE type = ${WATCHDOG_EVENT_TYPE} AND data->>'problem' = ${key}`
  return rows[0]?.at ?? null
}

async function notify(problem: WatchProblem, now: Date, remindHours: number): Promise<{ sent: boolean }> {
  const { notifyStaff } = await import('@/lib/notifications/staff')
  const window = Math.floor(now.getTime() / (remindHours * HOUR_MS))
  const res = await notifyStaff(
    {
      level: problem.level,
      type: WATCHDOG_EVENT_TYPE,
      title: problem.title,
      lines: problem.lines,
      data: { problem: problem.key },
      dedupeKey: `${WATCHDOG_EVENT_TYPE}:${problem.key}:${window}`,
      link: '/admin-giga-panel/settings',
      // settings.manage есть только у Super Admin (lib/admin/rbac.ts).
      audiencePermission: WATCHDOG_AUDIENCE,
      // Свой интервал повторов — общий cooldown по типу не нужен.
      skipCooldown: true,
    },
    { now },
  )
  // Событие в ленте ГИГА уже есть — его видно в панели, даже если ни один канал не доставил.
  return { sent: res.eventId !== null && !res.duplicate }
}

// The direct alarm about the watchdog's own database failure: once per 6 h per process.
const DIRECT_KEY = Symbol.for('aistart360.ops.watchdog.direct')
async function alertDirect(problem: WatchProblem): Promise<unknown> {
  const g = globalThis as Record<symbol, Map<string, number> | undefined>
  const sentAt = (g[DIRECT_KEY] ??= new Map<string, number>())
  const last = sentAt.get(problem.key)
  if (last !== undefined && Date.now() - last < WATCHDOG_REMIND_HOURS * HOUR_MS) return null
  sentAt.set(problem.key, Date.now())
  console.error(`[ops-watchdog] ${problem.title}: ${problem.lines.join(' ')}`)
  return sendOpsDirect({ level: problem.level, title: problem.title, lines: problem.lines })
}

async function inngestCrons(): Promise<InngestCron[]> {
  const { inngestCronSchedules } = await import('@/lib/functions/registry')
  return inngestCronSchedules(portalRole())
}

async function platformChecks(): Promise<HealthCheckLike[]> {
  const { platformHealthSnapshot } = await import('@/lib/agents/definitions/monitoring')
  return platformHealthSnapshot()
}

// ─── ГИГА → Система: что показать персоналу ──────────────────────────────────

export interface OpsOverview {
  /** not_migrated — migration 154 is not applied here: no journal to show. */
  journal: 'ok' | 'not_migrated'
  jobs: JobView[]
  alertRoutes: AlertRoutes & { nowhere: boolean }
  /**
   * The last pass of the watchdog could not send its alerts (it answered WATCHDOG_UNDELIVERED_HTTP,
   * NV-4): when, else null.
   */
  alertsUndeliveredAt: string | null
}

/**
 * The state of every scheduled job (last run, status, health) and where alarms can go, for the
 * system card in GIGA (/api/giga-admin/system/health). Read only; the same rules as the watchdog.
 */
export async function opsOverview(
  now: Date = new Date(),
  // Read only: the GIGA card does not start anyone's «never» count.
  deps: Pick<WatchdogDeps, 'role' | 'inngestCrons' | 'loadJobs' | 'alertRoutes'> = { ...defaultDeps, loadJobs: (expected) => loadJobsState(expected) },
): Promise<OpsOverview> {
  const crons = await deps.inngestCrons().catch(() => [] as InngestCron[])
  const expected = expectedJobs(deps.role(), crons)
  const [state, routes] = await Promise.all([deps.loadJobs(expected), deps.alertRoutes()])
  const watchdogRun = state?.last.get('/api/cron/ops-watchdog') ?? null
  return {
    journal: state ? 'ok' : 'not_migrated',
    jobs: state ? assessJobs(state, now).views : [],
    alertRoutes: { ...routes, nowhere: alertsGoNowhere(routes) },
    alertsUndeliveredAt: watchdogRun && watchdogRun.status === 'http_error' && watchdogRun.httpStatus === WATCHDOG_UNDELIVERED_HTTP
      ? watchdogRun.finishedAt.toISOString()
      : null,
  }
}

export const defaultDeps: WatchdogDeps = {
  role: () => portalRole(),
  inngestCrons,
  loadJobs: (expected) => loadJobsState(expected, { recordExpectations: true }),
  pointAQueue,
  platformChecks,
  demo,
  alertRoutes: () => loadAlertRoutes(),
  agentsService,
  prune,
  lastAlertAt,
  notify,
  alertDirect,
}
