/**
 * lib/cron/schedule.ts — what runs when, for the in-process scheduler (lib/cron/runner.ts).
 *
 * Vercel Cron called these paths on a UTC schedule; a persistent server (Railway) has no such
 * service, so the portal calls them itself. Since the domain switch (2026-11-04) the crons are no
 * longer in `vercel.json`: this file is the only copy, pinned by tests/unit/cron/schedule.test.ts.
 *
 * The same build also runs as the agents service (PORTAL_ROLE, lib/runtime/role.ts), so every job
 * says which of the two services runs it once they are separate processes; `jobsForRole` is the
 * list a process schedules. One process for everything (the default) schedules what Vercel ran.
 */
import { Cron } from 'croner'
import type { PortalRole } from '@/lib/runtime/role'

export interface CronJob {
  /** Route called with `GET` and `Authorization: Bearer <CRON_SECRET>`. */
  path: string
  /** Five-field cron expression, read in UTC. */
  schedule: string
  /** The service that runs the job when the portal and the agents service are separate. Absent = 'web'. */
  role?: 'web' | 'agents'
  /**
   * Only a process dedicated to the job's role schedules it; one process for everything ('all')
   * does not, because there something else already does the work.
   */
  dedicatedOnly?: boolean
}

export const CRON_JOBS: readonly CronJob[] = [
  { path: '/api/cron/billing-expiry', schedule: '15 0 * * *' },
  { path: '/api/cron/staff-digest', schedule: '0 3 * * *' },
  { path: '/api/cron/crm-digest', schedule: '0 4 * * *' },
  { path: '/api/cron/agents-digest', schedule: '0 4 * * *', role: 'agents' },
  { path: '/api/cron/client-digest', schedule: '0 4 * * 1' },
  { path: '/api/telegram/personal/sync', schedule: '0 5 * * *' },
  { path: '/api/cron/reminders', schedule: '0 6 * * *' },
  // 21:30, не 22:00 (N4A-14): в 22:00 UTC стартуют ночной пересчёт Точки А и пересчёт Точки Б.
  { path: '/api/cron/analytics-rollup', schedule: '30 21 * * *' },
  { path: '/api/cron/ai-discovery', schedule: '30 1 * * *' },
  // Сторож бэкапов (R-011): ежечасно, в :07 — журнал ops_backup_runs свежее 10 ч, иначе Super Admin.
  { path: '/api/cron/backup-freshness', schedule: '7 * * * *' },
  // SLA экспертов (R2-B): каждые 5 минут — задачи, авто-назначение, эскалация 24 ч, просрочка 48 ч.
  // Раньше — Inngest cron `expert-sla-watch`, но Inngest Cloud на Railway не вызывает портал.
  { path: '/api/cron/expert-sla', schedule: '*/5 * * * *' },
  // Сторож задач (R4-A1): каждые 10 минут, в :03, :13, … — журнал ops_job_runs против расписания,
  // очередь Точки А, проверки мониторинга без ИИ, демо-аккаунты; ретенция журналов (lib/ops/job-watchdog.ts).
  { path: '/api/cron/ops-watchdog', schedule: '3-59/10 * * * *' },
  // Срок ответа на заявку на оплату (R4, N4B-1): каждые 15 минут, в :08, :23, :38, :53 — открытая заявка
  // старше request_sla_hours (4 ч) получает одно напоминание Admin / Super Admin (lib/access/request-notices.ts).
  { path: '/api/cron/access-requests', schedule: '8-59/15 * * * *' },
  // Автосинхронизация CRM (Bitrix24 / amoCRM → клиенты): дважды в час, в :17 и :47 (минуты без других
  // задач), кроме 21:00–22:59 UTC — окна ночных пересчётов Точек А и Б. Подключение, не обновлявшееся
  // 6 ч, ≤ 2 одновременно, проход ≤ 44 с (lib/crm/sync-cron.ts).
  { path: '/api/cron/crm-sync', schedule: '17,47 0-20,23 * * *' },
  // Перекрёстный сторож (R4-A1): сервис агентов раз в 3 минуты проверяет портал и базу, тревога —
  // напрямую в Telegram без базы (lib/ops/crosswatch.ts). Только при отдельном сервисе агентов.
  { path: '/api/cron/ops-crosswatch', schedule: '*/3 * * * *', role: 'agents', dedicatedOnly: true },
  // The agents service has no public domain and so no Inngest: this call is its queue maintenance,
  // the stand-in for the Inngest cron `agents-maintenance` that one process for everything relies on.
  { path: '/api/cron/agents', schedule: '* * * * *', role: 'agents', dedicatedOnly: true },
]

/**
 * The jobs a process of `role` schedules:
 *   'all'    - every job that is not `dedicatedOnly` (the schedule Vercel ran, in the same order);
 *   'web'    - the jobs of the portal (a job without a role is the portal's);
 *   'agents' - the jobs of the agents service, the `dedicatedOnly` ones included.
 */
export function jobsForRole(role: PortalRole, jobs: readonly CronJob[] = CRON_JOBS): CronJob[] {
  if (role === 'all') return jobs.filter((job) => !job.dedicatedOnly)
  return jobs.filter((job) => (job.role ?? 'web') === role)
}

const MINUTE_MS = 60_000

/**
 * The jobs whose expression matches the UTC minute `minute` falls in. Any moment inside the minute
 * counts (croner only matches second 0), so the caller does not have to round. Without `jobs` it
 * looks at every job of every service: a scheduler passes the list of its role (`jobsForRole`).
 */
export function dueJobs(minute: Date, jobs: readonly CronJob[] = CRON_JOBS): CronJob[] {
  const start = new Date(Math.floor(minute.getTime() / MINUTE_MS) * MINUTE_MS)
  // `paused` and no callback: croner only parses and matches here, it never arms a timer.
  return jobs.filter((job) => new Cron(job.schedule, { timezone: 'UTC', paused: true }).match(start))
}
