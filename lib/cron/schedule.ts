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
  { path: '/api/cron/analytics-rollup', schedule: '0 22 * * *' },
  { path: '/api/cron/ai-discovery', schedule: '30 1 * * *' },
  // Сторож бэкапов (R-011): ежечасно, в :07 — журнал ops_backup_runs свежее 10 ч, иначе Super Admin.
  { path: '/api/cron/backup-freshness', schedule: '7 * * * *' },
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
