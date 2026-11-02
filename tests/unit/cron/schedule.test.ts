/**
 * lib/cron/schedule.ts — the portal's own copy of the Vercel Cron schedule. While Vercel still runs
 * the crons (the test period) the two must say the same thing, otherwise a job would run on one
 * platform and not on the other. When the crons leave vercel.json at the domain switch, this test
 * goes with them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRON_JOBS } from '@/lib/cron/schedule'

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)

describe('CRON_JOBS', () => {
  it('equals the crons of vercel.json while Vercel still runs them (order does not matter)', () => {
    const cfg = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: { path: string; schedule: string }[]
    }
    expect(cfg.crons.length).toBe(9)
    expect([...CRON_JOBS].sort(byPath)).toEqual([...cfg.crons].sort(byPath))
  })

  it('has one entry per path', () => {
    const paths = CRON_JOBS.map((job) => job.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
