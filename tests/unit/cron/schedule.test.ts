/**
 * lib/cron/schedule.ts — the portal's schedule. Since the domain moved to Railway (2026-11-04) the
 * crons are no longer in vercel.json and this list is the only copy, so it is pinned here exactly as
 * Vercel ran it (UTC).
 *
 * Since the agents service (PORTAL_ROLE, docs/railway-agents-service.md) every job also says which
 * service runs it. What one process for everything ('all', the default) schedules is still exactly
 * what Vercel ran; the per-minute queue drain exists only for a process dedicated to agent work.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRON_JOBS, dueJobs, jobsForRole } from '@/lib/cron/schedule'

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
const timesOf = (jobs: readonly { path: string; schedule: string }[]) => jobs.map(({ path, schedule }) => ({ path, schedule }))

/** The schedule Vercel ran, in the order of the list. */
const VERCEL_SCHEDULE = [
  { path: '/api/cron/billing-expiry', schedule: '15 0 * * *' },
  { path: '/api/cron/staff-digest', schedule: '0 3 * * *' },
  // R-230 moved it to 04:11; the review of wave 1A added the catch-up run at 05:11 (one digest per owner per day).
  { path: '/api/cron/crm-digest', schedule: '11 4,5 * * *' },
  { path: '/api/cron/agents-digest', schedule: '41 4 * * *' },
  // Vercel ran it at 04:00 Mondays; R-230 moved it to 04:26, the review of wave 1A added the catch-up run at 05:26.
  { path: '/api/cron/client-digest', schedule: '26 4,5 * * 1' },
  { path: '/api/telegram/personal/sync', schedule: '0 5 * * *' },
  { path: '/api/cron/reminders', schedule: '0 6 * * *' },
  // Vercel ran it at 22:00; R4-A1 (N4A-14) moved it to 21:30, away from the 22:00 recalculations of Points A and B.
  { path: '/api/cron/analytics-rollup', schedule: '30 21 * * *' },
  { path: '/api/cron/ai-discovery', schedule: '30 1 * * *' },
]

/** Added on Railway, after Vercel: the hourly backup watchdog (R-011, lib/ops/backup-freshness.ts). */
const RAILWAY_ADDED = [
  { path: '/api/cron/backup-freshness', schedule: '7 * * * *' },
  // Expert SLA (R2-B): the portal's scheduler runs it, Inngest Cloud does not call the portal on Railway.
  { path: '/api/cron/expert-sla', schedule: '*/5 * * * *' },
  // The job watchdog (R4-A1, lib/ops/job-watchdog.ts): every 10 minutes, off the :00/:05 minutes.
  { path: '/api/cron/ops-watchdog', schedule: '3-59/10 * * * *' },
  // The answer deadline of a request for paid access (R4, N4B-1): every 15 minutes, off the :00/:05 minutes.
  { path: '/api/cron/access-requests', schedule: '8-59/15 * * * *' },
  // The automatic CRM sync (CRM revival 2026-11-18, lib/crm/sync-cron.ts): :17 and :47, not 21:00–22:59 UTC.
  { path: '/api/cron/crm-sync', schedule: '17,47 0-20,23 * * *' },
]
/** What one process for everything schedules: the Vercel schedule plus the Railway additions. */
const PORTAL_SCHEDULE = [...VERCEL_SCHEDULE, ...RAILWAY_ADDED]

describe('CRON_JOBS', () => {
  it('is the schedule Vercel ran plus the queue drain of the agents service, job for job (order does not matter)', () => {
    const expected = [
      { path: '/api/cron/billing-expiry', schedule: '15 0 * * *' },
      { path: '/api/cron/staff-digest', schedule: '0 3 * * *' },
      { path: '/api/cron/crm-digest', schedule: '11 4,5 * * *' },
      { path: '/api/cron/agents-digest', schedule: '41 4 * * *', role: 'agents' },
      { path: '/api/cron/client-digest', schedule: '26 4,5 * * 1' },
      { path: '/api/telegram/personal/sync', schedule: '0 5 * * *' },
      { path: '/api/cron/reminders', schedule: '0 6 * * *' },
      { path: '/api/cron/analytics-rollup', schedule: '30 21 * * *' },
      { path: '/api/cron/ai-discovery', schedule: '30 1 * * *' },
      { path: '/api/cron/agents', schedule: '* * * * *', role: 'agents', dedicatedOnly: true },
      { path: '/api/cron/backup-freshness', schedule: '7 * * * *' },
      { path: '/api/cron/expert-sla', schedule: '*/5 * * * *' },
      { path: '/api/cron/ops-watchdog', schedule: '3-59/10 * * * *' },
      { path: '/api/cron/access-requests', schedule: '8-59/15 * * * *' },
      { path: '/api/cron/crm-sync', schedule: '17,47 0-20,23 * * *' },
      { path: '/api/cron/ops-crosswatch', schedule: '*/3 * * * *', role: 'agents', dedicatedOnly: true },
    ]
    expect([...CRON_JOBS].sort(byPath)).toEqual(expected.sort(byPath))
  })

  it('vercel.json has no crons any more: the in-process scheduler refuses to start while it does', () => {
    const cfg = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as { crons?: unknown[] }
    expect(cfg.crons ?? []).toEqual([])
  })

  it('has one entry per path', () => {
    const paths = CRON_JOBS.map((job) => job.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('the jobs that exist for a dedicated service alone: the per-minute queue drain and the cross-watch of the portal', () => {
    expect(CRON_JOBS.filter((job) => job.dedicatedOnly).sort(byPath)).toEqual([
      { path: '/api/cron/agents', schedule: '* * * * *', role: 'agents', dedicatedOnly: true },
      { path: '/api/cron/ops-crosswatch', schedule: '*/3 * * * *', role: 'agents', dedicatedOnly: true },
    ])
  })

  it('N4A-14: nothing of the portal starts at 22:00 UTC, when the recalculations of Points A and B do', () => {
    const at22 = CRON_JOBS.filter((job) => /^0 22 /.test(job.schedule)).map((job) => job.path)
    expect(at22).toEqual([])
    expect(CRON_JOBS.find((job) => job.path === '/api/cron/analytics-rollup')?.schedule).toBe('30 21 * * *')
  })
})

describe('jobsForRole', () => {
  it("'all' (one process for everything, the default) is the schedule Vercel ran plus the backup watchdog, in the same order", () => {
    expect(timesOf(jobsForRole('all'))).toEqual(PORTAL_SCHEDULE)
  })

  it("'all' never drains the agent queue every minute: there the Inngest maintenance does it", () => {
    const jobs = jobsForRole('all')
    expect(jobs.map((job) => job.path)).not.toContain('/api/cron/agents')
    expect(jobs.some((job) => job.dedicatedOnly)).toBe(false)
    expect(jobs.some((job) => job.schedule === '* * * * *')).toBe(false)
  })

  it("'web' is the portal's own: that schedule without the agents digest", () => {
    expect(timesOf(jobsForRole('web'))).toEqual(PORTAL_SCHEDULE.filter((job) => job.path !== '/api/cron/agents-digest'))
  })

  it("'agents' is the agents digest, the cross-watch of the portal and the queue drain every minute", () => {
    expect(timesOf(jobsForRole('agents'))).toEqual([
      { path: '/api/cron/agents-digest', schedule: '41 4 * * *' },
      { path: '/api/cron/ops-crosswatch', schedule: '*/3 * * * *' },
      { path: '/api/cron/agents', schedule: '* * * * *' },
    ])
  })

  it('the portal and the agents service share no job, and together they run every one', () => {
    const web = jobsForRole('web').map((job) => job.path)
    const agents = jobsForRole('agents').map((job) => job.path)
    expect(web.filter((path) => agents.includes(path))).toEqual([])
    expect([...web, ...agents].sort()).toEqual(CRON_JOBS.map((job) => job.path).sort())
  })

  it('the two services together run everything one process ran, each job once', () => {
    const split = [...jobsForRole('web'), ...jobsForRole('agents')].filter((job) => !job.dedicatedOnly)
    expect(timesOf(split).sort(byPath)).toEqual([...PORTAL_SCHEDULE].sort(byPath))
  })

  it('takes the job list as an argument; a job without a role belongs to the portal', () => {
    const jobs = [
      { path: '/plain', schedule: '0 * * * *' },
      { path: '/web', schedule: '0 * * * *', role: 'web' as const },
      { path: '/agents', schedule: '0 * * * *', role: 'agents' as const },
      { path: '/agents-only', schedule: '* * * * *', role: 'agents' as const, dedicatedOnly: true },
      { path: '/web-only', schedule: '* * * * *', dedicatedOnly: true },
    ]
    const paths = (role: 'all' | 'web' | 'agents') => jobsForRole(role, jobs).map((job) => job.path)
    expect(paths('all')).toEqual(['/plain', '/web', '/agents'])
    expect(paths('web')).toEqual(['/plain', '/web', '/web-only'])
    expect(paths('agents')).toEqual(['/agents', '/agents-only'])
  })

  it('returns a new array and leaves the list alone', () => {
    const before = [...CRON_JOBS]
    const jobs = jobsForRole('all')
    jobs.pop()
    expect([...CRON_JOBS]).toEqual(before)
    expect(jobsForRole('all')).toHaveLength(PORTAL_SCHEDULE.length)
  })
})

describe('the automatic CRM sync (/api/cron/crm-sync)', () => {
  // Every minute of one UTC day, and the jobs one process for everything has due in it.
  const day = Array.from({ length: 24 * 60 }, (_, m) => new Date(Date.UTC(2026, 10, 18, 0, m)))
  const crmMinutes = day.filter((minute) => dueJobs(minute, jobsForRole('all')).some((job) => job.path === '/api/cron/crm-sync'))

  it('runs twice an hour, at :17 and :47', () => {
    expect(new Set(crmMinutes.map((m) => m.getUTCMinutes()))).toEqual(new Set([17, 47]))
    expect(crmMinutes).toHaveLength(22 * 2)
  })

  it('never inside 21:45–23:00 UTC, the window of the nightly recalculations of Points A and B', () => {
    const inWindow = crmMinutes.filter((m) => {
      const t = m.getUTCHours() * 60 + m.getUTCMinutes()
      return t >= 21 * 60 + 45 && t < 23 * 60
    })
    expect(inWindow).toEqual([])
  })

  it('shares its minute with no other job (the scheduler has two slots)', () => {
    const shared = crmMinutes.filter((minute) => dueJobs(minute, jobsForRole('all')).length > 1)
    expect(shared.map((m) => m.toISOString())).toEqual([])
  })
})

// R-230: crm-digest, agents-digest and client-digest all fired at 04:00 UTC — on a Monday three
// mailings in one minute, on the hour of the hourly Point B recompute (Inngest `pb-recompute`, :00).
describe('R-230: the morning digests are spread by minutes', () => {
  const DIGESTS = ['/api/cron/crm-digest', '/api/cron/client-digest', '/api/cron/agents-digest']
  // A Monday (all three are due): every minute of it.
  const monday = Array.from({ length: 24 * 60 }, (_, m) => new Date(Date.UTC(2026, 10, 23, 0, m)))
  const minutesOf = (path: string) => monday.filter((minute) => dueJobs(minute, jobsForRole('all')).some((job) => job.path === path))

  const iso = (m: Date) => m.toISOString().slice(11, 16)

  it('each fires first in the 04:xx UTC morning (09:xx Almaty), off the hour, each in a minute of its own', () => {
    const at = DIGESTS.map((p) => minutesOf(p))
    for (const m of at) {
      expect(m[0].getUTCHours()).toBe(4)
      expect(m[0].getUTCMinutes()).not.toBe(0)
    }
    expect(new Set(at.map((m) => m[0].getUTCMinutes())).size).toBe(3)
  })

  // Review of wave 1A: the 44 s / ≤ 2 budget can defer clients; a catch-up run an hour later starts
  // only those without this week's digest (lib/automation/client-digest.ts).
  it('client-digest and crm-digest run again an hour later to catch up; the agents digest once', () => {
    expect(minutesOf('/api/cron/client-digest').map(iso)).toEqual(['04:26', '05:26'])
    expect(minutesOf('/api/cron/crm-digest').map(iso)).toEqual(['04:11', '05:11'])
    expect(minutesOf('/api/cron/agents-digest').map(iso)).toEqual(['04:41'])
  })

  it('no other job of either service is due in any of their minutes (agents: only its every-minute queue drain)', () => {
    for (const path of DIGESTS) {
      for (const minute of minutesOf(path)) {
        expect(dueJobs(minute, jobsForRole('all')).map((j) => j.path)).toEqual([path])
        const agents = dueJobs(minute, jobsForRole('agents')).map((j) => j.path).filter((p) => p !== '/api/cron/agents')
        expect(agents.filter((p) => p !== path)).toEqual([])
      }
    }
  })
})
