/**
 * lib/cron/schedule.ts — the portal's schedule. Since the domain moved to Railway (2026-11-04) the
 * crons are no longer in vercel.json and this list is the only copy, so it is pinned here exactly as
 * Vercel ran it (UTC).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRON_JOBS } from '@/lib/cron/schedule'

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)

describe('CRON_JOBS', () => {
  it('is the schedule Vercel ran, job for job (order does not matter)', () => {
    const expected = [
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
})
