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
import { CRON_JOBS, jobsForRole } from '@/lib/cron/schedule'

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
const timesOf = (jobs: readonly { path: string; schedule: string }[]) => jobs.map(({ path, schedule }) => ({ path, schedule }))

/** The schedule Vercel ran, in the order of the list. */
const VERCEL_SCHEDULE = [
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

describe('CRON_JOBS', () => {
  it('is the schedule Vercel ran plus the queue drain of the agents service, job for job (order does not matter)', () => {
    const expected = [
      { path: '/api/cron/billing-expiry', schedule: '15 0 * * *' },
      { path: '/api/cron/staff-digest', schedule: '0 3 * * *' },
      { path: '/api/cron/crm-digest', schedule: '0 4 * * *' },
      { path: '/api/cron/agents-digest', schedule: '0 4 * * *', role: 'agents' },
      { path: '/api/cron/client-digest', schedule: '0 4 * * 1' },
      { path: '/api/telegram/personal/sync', schedule: '0 5 * * *' },
      { path: '/api/cron/reminders', schedule: '0 6 * * *' },
      { path: '/api/cron/analytics-rollup', schedule: '0 22 * * *' },
      { path: '/api/cron/ai-discovery', schedule: '30 1 * * *' },
      { path: '/api/cron/agents', schedule: '* * * * *', role: 'agents', dedicatedOnly: true },
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

  it('the only job that exists for a dedicated service alone is the per-minute queue drain', () => {
    expect(CRON_JOBS.filter((job) => job.dedicatedOnly)).toEqual([
      { path: '/api/cron/agents', schedule: '* * * * *', role: 'agents', dedicatedOnly: true },
    ])
  })
})

describe('jobsForRole', () => {
  it("'all' (one process for everything, the default) is the schedule Vercel ran: the same nine jobs in the same order", () => {
    expect(timesOf(jobsForRole('all'))).toEqual(VERCEL_SCHEDULE)
  })

  it("'all' never drains the agent queue every minute: there the Inngest maintenance does it", () => {
    const jobs = jobsForRole('all')
    expect(jobs.map((job) => job.path)).not.toContain('/api/cron/agents')
    expect(jobs.some((job) => job.dedicatedOnly)).toBe(false)
    expect(jobs.some((job) => job.schedule === '* * * * *')).toBe(false)
  })

  it("'web' is the portal's own eight: the Vercel schedule without the agents digest", () => {
    expect(timesOf(jobsForRole('web'))).toEqual(VERCEL_SCHEDULE.filter((job) => job.path !== '/api/cron/agents-digest'))
  })

  it("'agents' is the agents digest and the queue drain every minute", () => {
    expect(timesOf(jobsForRole('agents'))).toEqual([
      { path: '/api/cron/agents-digest', schedule: '0 4 * * *' },
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
    expect(timesOf(split).sort(byPath)).toEqual([...VERCEL_SCHEDULE].sort(byPath))
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
    expect(jobsForRole('all')).toHaveLength(9)
  })
})
