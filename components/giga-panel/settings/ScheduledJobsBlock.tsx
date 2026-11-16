'use client'

import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { cx, fmtAgo } from '@/components/giga-panel/kit'

/**
 * GIGA → Настройки → «Состояние системы»: задачи по расписанию и куда приходят тревоги (R4-A1).
 * Данные — `ops` из /api/giga-admin/system/health (lib/ops/job-watchdog.ts opsOverview): последний
 * запуск каждой задачи из журнала ops_job_runs и её состояние по тем же правилам, что у сторожа.
 */

export type JobHealth = 'ok' | 'stale' | 'never' | 'failing' | 'waiting'

export interface OpsJob {
  job: string
  label: string
  kind: 'cron' | 'inngest'
  schedule: string
  lastAt: string | null
  lastStatus: string | null
  health: JobHealth
  allowedMinutes: number
}

export interface OpsData {
  journal: 'ok' | 'not_migrated'
  jobs: OpsJob[]
  alertRoutes: { linkedStaff: number; envChats: number; direct: boolean; nowhere: boolean }
  /** The last pass of the watchdog could not send its alerts (NV-4); absent on older deployments. */
  alertsUndeliveredAt?: string | null
}

export interface OpsFailure {
  kind: 'not_migrated' | 'failed'
  message: string
}

const HEALTH: Record<JobHealth, { label: string; cls: string }> = {
  ok: { label: 'норма', cls: 'text-emerald-300' },
  waiting: { label: 'ждём запуска', cls: 'text-slate-400' },
  failing: { label: 'ошибки', cls: 'text-amber-300' },
  stale: { label: 'не запускалась', cls: 'text-red-300' },
  never: { label: 'ни разу', cls: 'text-red-300' },
}

/** Problems (red) and warnings (amber) of the block, for the card's badges. */
export function opsCounts(ops: OpsData | null | undefined, error: OpsFailure | null | undefined): { problems: number; warnings: number } {
  const jobs = ops?.jobs ?? []
  return {
    problems: jobs.filter((j) => j.health === 'stale' || j.health === 'never').length
      + (ops?.alertRoutes.nowhere ? 1 : 0)
      + (ops?.alertsUndeliveredAt ? 1 : 0)
      + (error?.kind === 'failed' ? 1 : 0),
    warnings: jobs.filter((j) => j.health === 'failing').length,
  }
}

export function ScheduledJobsBlock({ ops, error }: { ops: OpsData | null | undefined; error: OpsFailure | null | undefined }) {
  return (
    <div className="mt-4 border-t border-white/[0.05] pt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Clock size={12} /> Задачи по расписанию и тревоги</p>
      {ops?.alertsUndeliveredAt && (
        <p role="alert" className="mb-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
          Тревоги не доставлены: последний проход сторожа ({fmtAgo(ops.alertsUndeliveredAt)}) не смог отправить тревоги — запись в ленту
          уведомлений не прошла. Проверьте базу данных и лог портала; список проблем ниже может быть неполным.
        </p>
      )}
      {ops?.alertRoutes.nowhere && (
        <p role="alert" className="mb-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
          Тревогам некуда приходить: ни один Super Admin не привязал Telegram (тревоги сторожа уходят только им), и TELEGRAM_ADMIN_CHAT_IDS
          не задан или у бота нет токена. Сбои видны только в ленте уведомлений, а тревоги без базы (не работают кроны, портал или база
          недоступны) — только в логах. Привяжите Telegram в «Уведомлениях».
        </p>
      )}
      {ops && (
        <p className="mb-2 text-[11px] text-slate-500">
          Telegram: Super Admin с привязкой (получают тревоги) — {ops.alertRoutes.linkedStaff}; чатов для тревог без базы (TELEGRAM_ADMIN_CHAT_IDS) — {ops.alertRoutes.envChats}
          {ops.alertRoutes.envChats > 0 && !ops.alertRoutes.direct ? ' (нет токена бота)' : ''}.
        </p>
      )}
      {error?.kind === 'failed' && (
        <p role="alert" className="text-[11px] text-red-300" title={error.message}>Журнал задач не прочитан: {error.message}</p>
      )}
      {ops?.journal === 'not_migrated' && (
        <p className="text-[11px] text-slate-500">Журнал задач недоступен: миграция 154 ещё не применена.</p>
      )}
      {ops && ops.journal === 'ok' && (
        <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
          {ops.jobs.map((j) => (
            <li key={j.job} className="flex items-center justify-between gap-3 text-[11px]" title={`${j.job} · ${j.schedule} (UTC) · допустимо ${j.allowedMinutes} мин`}>
              <span className={cx('min-w-0 truncate', j.health === 'ok' ? 'text-slate-300' : HEALTH[j.health].cls)}>{j.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-slate-500">{j.lastAt ? fmtAgo(j.lastAt) : 'не было'}</span>
                <span className={cx('w-24 text-right', HEALTH[j.health].cls)}>{HEALTH[j.health].label}</span>
                {j.health === 'ok' || j.health === 'waiting'
                  ? <CheckCircle2 size={13} className={cx('shrink-0', j.health === 'ok' ? 'text-emerald-400' : 'text-slate-500')} aria-hidden />
                  : j.health === 'failing'
                    ? <AlertTriangle size={13} className="shrink-0 text-amber-400" aria-hidden />
                    : <XCircle size={13} className="shrink-0 text-red-400" aria-hidden />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
