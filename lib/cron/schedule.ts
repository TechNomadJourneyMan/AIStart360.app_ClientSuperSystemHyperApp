/**
 * lib/cron/schedule.ts — what runs when, for the in-process scheduler (lib/cron/runner.ts).
 *
 * Vercel Cron called these paths on a UTC schedule; a persistent server (Railway) has no such
 * service, so the portal calls them itself. Since the domain switch (2026-11-04) the crons are no
 * longer in `vercel.json`: this file is the only copy, pinned by tests/unit/cron/schedule.test.ts.
 */
import { Cron } from 'croner'

export interface CronJob {
  /** Route called with `GET` and `Authorization: Bearer <CRON_SECRET>`. */
  path: string
  /** Five-field cron expression, read in UTC. */
  schedule: string
}

export const CRON_JOBS: readonly CronJob[] = [
  { path: '/api/cron/billing-expiry', schedule: '15 0 * * *' },
  { path: '/api/cron/staff-digest', schedule: '0 3 * * *' },
  { path: '/api/cron/crm-digest', schedule: '0 4 * * *' },
  { path: '/api/cron/agents-digest', schedule: '0 4 * * *' },
  { path: '/api/cron/client-digest', schedule: '0 4 * * 1' },
  { path: '/api/telegram/personal/sync', schedule: '0 5 * * *' },
  { path: '/api/cron/reminders', schedule: '0 6 * * *' },
  { path: '/api/cron/analytics-rollup', schedule: '0 22 * * *' },
  { path: '/api/cron/ai-discovery', schedule: '30 1 * * *' },
]

const MINUTE_MS = 60_000

/**
 * The jobs whose expression matches the UTC minute `minute` falls in. Any moment inside the minute
 * counts (croner only matches second 0), so the caller does not have to round.
 */
export function dueJobs(minute: Date, jobs: readonly CronJob[] = CRON_JOBS): CronJob[] {
  const start = new Date(Math.floor(minute.getTime() / MINUTE_MS) * MINUTE_MS)
  // `paused` and no callback: croner only parses and matches here, it never arms a timer.
  return jobs.filter((job) => new Cron(job.schedule, { timezone: 'UTC', paused: true }).match(start))
}
