/**
 * lib/ops/backup-freshness.ts — сторож бэкапов (R-011, docs/backup/README.md).
 *
 * Скрипт scripts/backup/railway-db-backup.sh (cron-сервис Railway `db-backup`, 3 раза в сутки)
 * пишет каждую попытку в public.ops_backup_runs (миграция 142). Крон портала
 * /api/cron/backup-freshness раз в час сверяет журнал:
 *
 *   • последний запуск kind='db' упал              → CRITICAL «db:failed:<id запуска>»;
 *   • успешного бэкапа базы нет ни одного          → CRITICAL «db:missing»;
 *   • последний успешный старше 10 ч               → CRITICAL «db:stale:<id последнего успешного>»;
 *   • последняя копия файлов Storage упала         → WARNING  «storage:failed:<id запуска>».
 *
 * Уведомление — notifyStaff (лента GIGA + Telegram персонала + письмо на ADMIN_NOTIFICATION_EMAIL
 * для CRITICAL), только сотрудникам с settings.manage (= Super Admin) и старым чатам
 * TELEGRAM_ADMIN_CHAT_IDS. Защита от спама: об одной проблеме (ключ) — не чаще раза в 6 ч
 * (последнее событие ops.backup с этим ключом в notification_events); ключ dedupe события ещё и
 * привязан к 6-часовому окну, так что два параллельных запуска не отправят дубль.
 * Новая проблема (другой упавший запуск) сообщается сразу.
 */
import { prisma } from '@/lib/db'
import { notifyStaff } from '@/lib/notifications/staff'

export const BACKUP_MAX_AGE_HOURS = 10
export const BACKUP_REMIND_HOURS = 6
export const BACKUP_EVENT_TYPE = 'ops.backup'

const HOUR_MS = 3600_000

export interface BackupRunRow {
  id: string
  kind: 'db' | 'storage' | 'vps'
  ok: boolean
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  objectKey: string | null
  bytes: number | null
}

export interface BackupState {
  /** Последний запуск kind='db' (успешный или нет). */
  lastDb: BackupRunRow | null
  /** Последний успешный запуск kind='db'. */
  lastOkDb: BackupRunRow | null
  /** Последний запуск kind='storage'. */
  lastStorage: BackupRunRow | null
}

export interface BackupProblem {
  /** Ключ проблемы: по нему считаются повторы. */
  key: string
  level: 'CRITICAL' | 'WARNING'
  title: string
  lines: string[]
}

const at = (r: BackupRunRow): Date => r.finishedAt ?? r.startedAt

function almaty(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function shortError(e: string | null): string {
  const line = (e ?? '').split('\n')[0].trim()
  if (!line) return 'причина не записана'
  return line.length > 300 ? `${line.slice(0, 297)}…` : line
}

function ageHours(d: Date, now: Date): number {
  return Math.floor((now.getTime() - d.getTime()) / HOUR_MS)
}

function lastOkLine(s: BackupState, now: Date): string {
  return s.lastOkDb
    ? `Последний успешный бэкап: ${almaty(at(s.lastOkDb))} (Алматы), ${ageHours(at(s.lastOkDb), now)} ч назад.`
    : 'Успешных бэкапов в журнале нет.'
}

const HOW_TO = 'Логи — Railway, сервис db-backup; порядок действий — docs/backup/README.md.'

/** Что не так с бэкапами сейчас. Пустой список — всё в порядке. */
export function assessBackups(s: BackupState, now: Date, maxAgeHours = BACKUP_MAX_AGE_HOURS): BackupProblem[] {
  const problems: BackupProblem[] = []

  if (s.lastDb && !s.lastDb.ok) {
    problems.push({
      key: `db:failed:${s.lastDb.id}`,
      level: 'CRITICAL',
      title: 'Бэкап базы не удался',
      lines: [
        `Запуск ${almaty(s.lastDb.startedAt)} (Алматы) завершился ошибкой: ${shortError(s.lastDb.error)}`,
        lastOkLine(s, now),
        HOW_TO,
      ],
    })
  } else if (!s.lastOkDb) {
    problems.push({
      key: 'db:missing',
      level: 'CRITICAL',
      title: 'Нет ни одного успешного бэкапа базы',
      lines: ['В журнале ops_backup_runs нет успешного запуска kind=db.', HOW_TO],
    })
  } else if (now.getTime() - at(s.lastOkDb).getTime() > maxAgeHours * HOUR_MS) {
    problems.push({
      key: `db:stale:${s.lastOkDb.id}`,
      level: 'CRITICAL',
      title: `Бэкапа базы нет дольше ${maxAgeHours} ч`,
      lines: [lastOkLine(s, now), 'Бэкап идёт 3 раза в сутки (05:30, 13:30, 21:30 Алматы) — запуск пропущен или завис.', HOW_TO],
    })
  }

  if (s.lastStorage && !s.lastStorage.ok) {
    problems.push({
      key: `storage:failed:${s.lastStorage.id}`,
      level: 'WARNING',
      title: 'Копия файлов Storage не удалась',
      lines: [
        `Запуск ${almaty(s.lastStorage.startedAt)} (Алматы): ${shortError(s.lastStorage.error)}`,
        'Дамп базы от этого не зависит; файлы клиентов в резервной копии могут быть неполными.',
        HOW_TO,
      ],
    })
  }
  return problems
}

export interface FreshnessDeps {
  loadState(): Promise<BackupState>
  /** Когда об этой проблеме последний раз сообщили (null — ни разу). */
  lastAlertAt(key: string): Promise<Date | null>
  /** sent=false — сообщение никуда не ушло; тогда следующий запуск попробует снова. */
  notify(problem: BackupProblem, now: Date): Promise<{ sent: boolean }>
}

export interface FreshnessReport {
  /** ok — проблем нет; alerted — что-то отправлено; quiet — проблемы есть, но о них уже сказали; unavailable — нет журнала. */
  status: 'ok' | 'alerted' | 'quiet' | 'unavailable'
  problems: string[]
  notified: string[]
}

function isMissingTable(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { code?: unknown }; message?: unknown }
  if (err?.code === '42P01' || err?.meta?.code === '42P01') return true
  return typeof err?.message === 'string' && /ops_backup_runs/.test(err.message) && /does not exist/.test(err.message)
}

export async function runBackupFreshness(now: Date = new Date(), deps: FreshnessDeps = defaultDeps): Promise<FreshnessReport> {
  let state: BackupState
  try {
    state = await deps.loadState()
  } catch (e) {
    if (isMissingTable(e)) return { status: 'unavailable', problems: [], notified: [] }
    throw e
  }

  const problems = assessBackups(state, now)
  const notified: string[] = []
  for (const p of problems) {
    const last = await deps.lastAlertAt(p.key)
    if (last && now.getTime() - last.getTime() < BACKUP_REMIND_HOURS * HOUR_MS) continue
    const res = await deps.notify(p, now)
    if (res.sent) notified.push(p.key)
  }
  return {
    status: problems.length === 0 ? 'ok' : notified.length > 0 ? 'alerted' : 'quiet',
    problems: problems.map((p) => p.key),
    notified,
  }
}

// ─── База и рассылка по умолчанию ────────────────────────────────────────────

type Row = {
  id: string
  kind: BackupRunRow['kind']
  ok: boolean
  started_at: Date
  finished_at: Date | null
  error: string | null
  object_key: string | null
  bytes: bigint | number | null
}

const toRun = (r: Row | undefined): BackupRunRow | null =>
  r
    ? {
        id: r.id,
        kind: r.kind,
        ok: r.ok,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        error: r.error,
        objectKey: r.object_key,
        bytes: r.bytes === null ? null : Number(r.bytes),
      }
    : null

async function loadState(): Promise<BackupState> {
  const cols = 'id::text AS id, kind, ok, started_at, finished_at, error, object_key, bytes'
  const [lastDb, lastOkDb, lastStorage] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(`SELECT ${cols} FROM public.ops_backup_runs WHERE kind = 'db' ORDER BY started_at DESC LIMIT 1`),
    prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${cols} FROM public.ops_backup_runs WHERE kind = 'db' AND ok ORDER BY finished_at DESC NULLS LAST, started_at DESC LIMIT 1`,
    ),
    prisma.$queryRawUnsafe<Row[]>(`SELECT ${cols} FROM public.ops_backup_runs WHERE kind = 'storage' ORDER BY started_at DESC LIMIT 1`),
  ])
  return { lastDb: toRun(lastDb[0]), lastOkDb: toRun(lastOkDb[0]), lastStorage: toRun(lastStorage[0]) }
}

async function lastAlertAt(key: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ at: Date | null }>>`
    SELECT max(created_at) AS at FROM public.notification_events
    WHERE type = ${BACKUP_EVENT_TYPE} AND data->>'problem' = ${key}`
  return rows[0]?.at ?? null
}

async function notify(problem: BackupProblem, now: Date): Promise<{ sent: boolean }> {
  const window = Math.floor(now.getTime() / (BACKUP_REMIND_HOURS * HOUR_MS))
  const res = await notifyStaff(
    {
      level: problem.level,
      type: BACKUP_EVENT_TYPE,
      title: problem.title,
      lines: problem.lines,
      data: { problem: problem.key },
      dedupeKey: `${BACKUP_EVENT_TYPE}:${problem.key}:${window}`,
      // settings.manage есть только у Super Admin (lib/admin/rbac.ts).
      audiencePermission: 'settings.manage',
      // Свой интервал повторов (6 ч) — общий cooldown по типу не нужен.
      skipCooldown: true,
    },
    { now },
  )
  // Событие в ленте GIGA уже есть — его видно в панели, даже если ни один канал не доставил.
  // Повтор (тот же ключ окна) — значит, отправлял параллельный запуск.
  return { sent: res.eventId !== null && !res.duplicate }
}

export const defaultDeps: FreshnessDeps = { loadState, lastAlertAt, notify }
