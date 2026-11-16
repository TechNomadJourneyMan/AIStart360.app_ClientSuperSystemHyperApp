/**
 * lib/ops/job-watchdog.ts — the job watchdog (R4-A1): the journal of job outcomes against the
 * schedule (×2, never less than the interval + 15 min), the Point A queue, the monitoring checks
 * without the «Агенты 24/7» switch, demo accounts, the agents service and «nowhere to alert».
 * Pure parts and the pass with stub dependencies; the real database is in
 * tests/integration/db/ops-job-runs.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  allowedStalenessMs, assessAlertRoutes, assessDemo, assessJobs, assessPlatform, assessPointAQueue,
  expectedJobs, maxGapMs, parseSchedule, runJobWatchdog,
  type ExpectedJob, type JobsState, type WatchdogDeps, type WatchProblem,
} from '@/lib/ops/job-watchdog'
import type { JobStatus } from '@/lib/ops/job-journal'

const MIN = 60_000
const H = 60 * MIN

describe('the schedule', () => {
  it('reads the Inngest TZ prefix; plain patterns are UTC', () => {
    expect(parseSchedule('TZ=Asia/Almaty 30 4 * * *')).toEqual({ pattern: '30 4 * * *', timezone: 'Asia/Almaty' })
    expect(parseSchedule('*/5 * * * *')).toEqual({ pattern: '*/5 * * * *', timezone: 'UTC' })
  })

  it('the longest gap between firings', () => {
    expect(maxGapMs('* * * * *')).toBe(MIN)
    expect(maxGapMs('*/5 * * * *')).toBe(5 * MIN)
    expect(maxGapMs('3-59/10 * * * *')).toBe(10 * MIN)
    expect(maxGapMs('7 * * * *')).toBe(H)
    expect(maxGapMs('0 22 * * *')).toBe(24 * H)
    expect(maxGapMs('0 4 * * 1')).toBe(7 * 24 * H)
    expect(maxGapMs('0 4 1 * *')).toBe(31 * 24 * H)
    expect(maxGapMs('0 22 * * 1,4')).toBe(4 * 24 * H) // Thursday → Monday
    // Amsterdam changes its clock: one day a year is 25 h long
    expect(maxGapMs('TZ=Europe/Amsterdam 0 3 * * *')).toBe(25 * H)
  })

  it('allowed age: twice the interval, never less than the interval plus 15 minutes', () => {
    expect(allowedStalenessMs(MIN)).toBe(16 * MIN)
    expect(allowedStalenessMs(5 * MIN)).toBe(20 * MIN)
    expect(allowedStalenessMs(H)).toBe(2 * H)
    expect(allowedStalenessMs(24 * H)).toBe(48 * H)
  })

  it('a split portal expects its own jobs and those of the agents service; one process the schedule of all', () => {
    const inngest = [{ id: 'ops-ping', cron: '*/10 * * * *' }]
    const web = expectedJobs('web', inngest).map((e) => e.job)
    expect(web).toContain('/api/cron/expert-sla')
    expect(web).toContain('/api/cron/agents')
    expect(web).toContain('/api/cron/ops-crosswatch')
    expect(web).toContain('inngest:ops-ping')
    const all = expectedJobs('all', []).map((e) => e.job)
    expect(all).not.toContain('/api/cron/agents') // there Inngest's agents-maintenance does it
    expect(all).not.toContain('/api/cron/ops-crosswatch')
    expect(all).toContain('/api/cron/ops-watchdog')
  })
})

describe('assessJobs', () => {
  const now = new Date('2026-11-16T12:00:00Z')
  const job = (j: string, schedule: string): ExpectedJob => {
    const gapMs = maxGapMs(schedule)
    return { job: j, kind: j.startsWith('inngest:') ? 'inngest' : 'cron', schedule, gapMs, allowedMs: allowedStalenessMs(gapMs) }
  }
  const state = (rows: Array<[string, number, JobStatus[]]>, journalAgeMs = 40 * 24 * H, expected?: ExpectedJob[]): JobsState => ({
    expected: expected ?? [job('/api/cron/expert-sla', '*/5 * * * *'), job('/api/cron/billing-expiry', '15 0 * * *'), job('inngest:ops-ping', '*/10 * * * *')],
    last: new Map(rows.map(([j, minutesAgo, statuses]) => [j, { job: j, status: statuses[0], finishedAt: new Date(now.getTime() - minutesAgo * MIN), httpStatus: statuses[0] === 'http_error' ? 500 : 200, error: statuses[0] === 'ok' ? null : 'HTTP 500' }])),
    recent: new Map(rows.map(([j, , statuses]) => [j, statuses])),
    journalSince: new Date(now.getTime() - journalAgeMs),
  })

  it('fresh and successful: no problems', () => {
    const { problems, views } = assessJobs(state([
      ['/api/cron/expert-sla', 3, ['ok', 'ok', 'ok']],
      ['/api/cron/billing-expiry', 12 * 60, ['ok']],
      ['inngest:ops-ping', 4, ['ok']],
    ]), now)
    expect(problems).toEqual([])
    expect(views.map((v) => v.health)).toEqual(['ok', 'ok', 'ok'])
  })

  it('a frequent job past its allowed age is CRITICAL, a daily one WARNING; the key names the job', () => {
    const { problems } = assessJobs(state([
      ['/api/cron/expert-sla', 21, ['ok']],
      ['/api/cron/billing-expiry', 49 * 60, ['ok']],
      ['inngest:ops-ping', 4, ['ok']],
    ]), now)
    expect(problems.map((p) => [p.key, p.level])).toEqual([
      ['job:stale:/api/cron/expert-sla', 'CRITICAL'],
      ['job:stale:/api/cron/billing-expiry', 'WARNING'],
    ])
    expect(problems[0].lines.join(' ')).toContain('SLA экспертов')
  })

  it('exactly at the allowed age it is still fine (the boundary belongs to «ok»)', () => {
    const { problems } = assessJobs(state([['/api/cron/expert-sla', 20, ['ok']], ['/api/cron/billing-expiry', 1, ['ok']], ['inngest:ops-ping', 1, ['ok']]]), now)
    expect(problems).toEqual([])
  })

  it('never in the journal: waiting while the journal is young, a problem once it is older than the allowed age', () => {
    const young = assessJobs(state([], 10 * MIN), now)
    expect(young.problems).toEqual([])
    expect(young.views.every((v) => v.health === 'waiting')).toBe(true)

    const old = assessJobs(state([['/api/cron/billing-expiry', 60, ['ok']]], 3 * H), now)
    expect(old.problems.map((p) => p.key)).toEqual(['job:never:/api/cron/expert-sla', 'job:never:inngest:ops-ping'])
    expect(old.problems[1].lines.join(' ')).toMatch(/inngest/)
  })

  it('failing: the last run of a rare job, or the last three of a frequent one, not ok', () => {
    const { problems } = assessJobs(state([
      ['/api/cron/expert-sla', 3, ['http_error', 'error', 'timeout']],
      ['/api/cron/billing-expiry', 60, ['http_error', 'ok']],
      ['inngest:ops-ping', 4, ['error', 'ok', 'ok']], // one failure of a frequent job: not yet
    ]), now)
    expect(problems.map((p) => [p.key, p.level])).toEqual([
      ['job:failing:/api/cron/expert-sla', 'WARNING'],
      ['job:failing:/api/cron/billing-expiry', 'WARNING'],
    ])
    expect(problems[1].lines.join(' ')).toContain('HTTP 500')
  })
})

describe('the other checks', () => {
  it('Point A queue: only overdue rows count — an hour overdue is a WARNING, six hours CRITICAL', () => {
    expect(assessPointAQueue({ due: 0, overdue: 0, oldestOverdueMinutes: null })).toEqual([])
    // the nightly wave: deep, but nothing overdue — legitimate
    expect(assessPointAQueue({ due: 40, overdue: 0, oldestOverdueMinutes: null })).toEqual([])
    expect(assessPointAQueue({ due: 3, overdue: 1, oldestOverdueMinutes: 61 })[0]).toMatchObject({ key: 'pa_queue:overdue', level: 'WARNING' })
    expect(assessPointAQueue({ due: 40, overdue: 5, oldestOverdueMinutes: 7 * 60 })[0]).toMatchObject({ level: 'CRITICAL' })
    expect(assessPointAQueue({ due: 40, overdue: 5, oldestOverdueMinutes: 7 * 60 })[0].lines[0]).toContain('Просрочено')
  })

  it('platform checks: warn → WARNING, critical → CRITICAL, ok → nothing', () => {
    const problems = assessPlatform([
      { key: 'agent_backlog', label: 'Агенты: очередь старше 15 мин', status: 'warn', value: 6, detail: 'x' },
      { key: 'agent_stuck', label: 'Агенты: зависшие задачи', status: 'critical', value: 4, detail: 'y' },
      { key: 'crm_sync_errors', label: 'CRM', status: 'ok', value: 0, detail: 'z' },
    ])
    expect(problems.map((p) => [p.key, p.level])).toEqual([['platform:agent_backlog', 'WARNING'], ['platform:agent_stuck', 'CRITICAL']])
  })

  it('demo accounts: more than 20 a day, or any older than 48 h', () => {
    expect(assessDemo({ created24h: 20, olderThan48h: 0 })).toEqual([])
    expect(assessDemo({ created24h: 21, olderThan48h: 2 }).map((p) => p.key)).toEqual(['demo:burst', 'demo:stale'])
  })

  it('alerts go nowhere only with no linked staff AND no TELEGRAM_ADMIN_CHAT_IDS', () => {
    expect(assessAlertRoutes({ linkedStaff: 0, envChats: 0, direct: false }).map((p) => p.key)).toEqual(['alerts:nowhere'])
    expect(assessAlertRoutes({ linkedStaff: 1, envChats: 0, direct: false })).toEqual([])
    expect(assessAlertRoutes({ linkedStaff: 0, envChats: 1, direct: true })).toEqual([])
  })
})

describe('runJobWatchdog', () => {
  const now = new Date('2026-11-16T12:00:00Z')

  function deps(over: Partial<WatchdogDeps> = {}) {
    const sent: Array<{ key: string; remind: number }> = []
    const direct: WatchProblem[] = []
    const d: WatchdogDeps = {
      role: () => 'web',
      inngestCrons: async () => [],
      loadJobs: async (expected) => ({ expected, last: new Map(), recent: new Map(), journalSince: new Date(now.getTime() - 5 * MIN) }),
      pointAQueue: async () => ({ due: 0, overdue: 0, oldestOverdueMinutes: null }),
      platformChecks: async () => [],
      demo: async () => ({ created24h: 0, olderThan48h: 0 }),
      alertRoutes: async () => ({ linkedStaff: 1, envChats: 0, direct: false }),
      agentsService: async () => ({ ok: true, detail: 'HTTP 200' }),
      prune: async () => ({ jobRuns: 0, cronRuns: 0 }),
      lastAlertAt: async () => null,
      notify: async (p, _now, remind) => { sent.push({ key: p.key, remind }); return { sent: true } },
      alertDirect: async (p) => { direct.push(p) },
      ...over,
    }
    return { d, sent, direct }
  }

  it('all fine: ok, nothing sent, retention ran', async () => {
    const t = deps()
    expect(await runJobWatchdog(now, t.d)).toEqual({ status: 'ok', journal: 'ok', problems: [], notified: [], failedChecks: [], pruned: { jobRuns: 0, cronRuns: 0 } })
    expect(t.sent).toEqual([])
  })

  it('problems are sent once per key: a recent alert keeps it quiet; «nowhere» reminds every 24 h', async () => {
    const t = deps({
      alertRoutes: async () => ({ linkedStaff: 0, envChats: 0, direct: false }),
      agentsService: async () => ({ ok: false, detail: 'нет ответа за 5 с' }),
      lastAlertAt: async (key) => (key === 'agents:down' ? new Date(now.getTime() - 2 * H) : null),
    })
    const report = await runJobWatchdog(now, t.d)
    expect(report.problems).toEqual(['alerts:nowhere', 'agents:down'])
    expect(report.notified).toEqual(['alerts:nowhere'])
    expect(report.status).toBe('alerted')
    expect(t.sent).toEqual([{ key: 'alerts:nowhere', remind: 24 }])
  })

  it('a check that fails is named and does not hide the others', async () => {
    const t = deps({
      demo: async () => { throw new Error('permission denied for schema auth') },
      pointAQueue: async () => ({ due: 9, overdue: 2, oldestOverdueMinutes: 90 }),
    })
    const report = await runJobWatchdog(now, t.d)
    expect(report.failedChecks).toEqual(['demo'])
    expect(report.problems).toEqual(['pa_queue:overdue'])
  })

  it('a feature not migrated here (relation does not exist) is skipped silently', async () => {
    const t = deps({ pointAQueue: async () => { throw Object.assign(new Error('relation "public.point_a_recalc_queue" does not exist'), { code: '42P01' }) } })
    const report = await runJobWatchdog(now, t.d)
    expect(report.failedChecks).toEqual([])
  })

  it('without migration 154 the journal part is skipped and the rest still runs', async () => {
    const t = deps({ loadJobs: async () => null, demo: async () => ({ created24h: 50, olderThan48h: 0 }) })
    const report = await runJobWatchdog(now, t.d)
    expect(report.journal).toBe('not_migrated')
    expect(report.problems).toEqual(['demo:burst'])
  })

  it('a database the watchdog cannot read: the alarm goes out directly (no database), and the pass fails', async () => {
    const t = deps({ loadJobs: async () => { throw new Error("Can't reach database server at postgres.railway.internal") } })
    await expect(runJobWatchdog(now, t.d)).rejects.toThrow(/reach database/)
    expect(t.direct).toHaveLength(1)
    expect(t.direct[0]).toMatchObject({ key: 'watchdog:db', level: 'CRITICAL' })
    expect(t.sent).toEqual([])
  })

  it('a failed retention is named, never fatal', async () => {
    const t = deps({ prune: vi.fn(async () => { throw new Error('cron_runs retention failed: timeout') }) })
    const report = await runJobWatchdog(now, t.d)
    expect(report.failedChecks).toEqual(['retention'])
    expect(report.status).toBe('ok')
  })
})

describe('opsOverview (GIGA → «Состояние системы»)', () => {
  it('the jobs with their health by the watchdog rules, and «nowhere to alert»', async () => {
    const { opsOverview } = await import('@/lib/ops/job-watchdog')
    const now = new Date('2026-11-16T12:00:00Z')
    const overview = await opsOverview(now, {
      role: () => 'web',
      inngestCrons: async () => [{ id: 'ops-ping', cron: '*/10 * * * *' }],
      loadJobs: async (expected) => ({
        expected,
        last: new Map([['inngest:ops-ping', { job: 'inngest:ops-ping', status: 'ok' as const, finishedAt: new Date(now.getTime() - 3 * H), httpStatus: null, error: null }]]),
        recent: new Map(),
        journalSince: new Date(now.getTime() - 5 * MIN),
      }),
      alertRoutes: async () => ({ linkedStaff: 0, envChats: 0, direct: false }),
    })
    expect(overview.journal).toBe('ok')
    expect(overview.jobs.find((j) => j.job === 'inngest:ops-ping')).toMatchObject({ health: 'stale', label: expect.stringContaining('Inngest') })
    expect(overview.jobs.find((j) => j.job === '/api/cron/expert-sla')).toMatchObject({ health: 'waiting', lastAt: null })
    expect(overview.alertRoutes).toEqual({ linkedStaff: 0, envChats: 0, direct: false, nowhere: true })
  })

  it('without the journal: not_migrated and no jobs', async () => {
    const { opsOverview } = await import('@/lib/ops/job-watchdog')
    const overview = await opsOverview(new Date(), {
      role: () => 'all', inngestCrons: async () => { throw new Error('registry') }, loadJobs: async () => null,
      alertRoutes: async () => ({ linkedStaff: 1, envChats: 0, direct: false }),
    })
    expect(overview).toMatchObject({ journal: 'not_migrated', jobs: [] })
  })
})

describe('the journal connection (lib/ops/job-journal.ts)', () => {
  it('the database Prisma of the process uses: DATABASE_URL, DIRECT_URL only with PRISMA_DATASOURCE=direct', async () => {
    const { journalConnectionString } = await import('@/lib/ops/job-journal')
    expect(journalConnectionString({ DATABASE_URL: 'postgres://pooler/db?pgbouncer=true', DIRECT_URL: 'postgres://direct/db' })).toBe('postgres://pooler/db?pgbouncer=true')
    expect(journalConnectionString({ DATABASE_URL: 'postgres://pooler/db', DIRECT_URL: 'postgres://direct/db', PRISMA_DATASOURCE: 'direct' })).toBe('postgres://direct/db')
    expect(journalConnectionString({ PRISMA_DATASOURCE: 'direct', DATABASE_URL: 'postgres://pooler/db' })).toBe('postgres://pooler/db')
    expect(journalConnectionString({})).toBeUndefined()
  })

  it('the first line of an error, cut to 300 characters; nothing is null', async () => {
    const { shortJobError } = await import('@/lib/ops/job-journal')
    expect(shortJobError(new Error('boom\nstack'))).toBe('boom')
    expect(shortJobError('x'.repeat(400))).toHaveLength(300)
    expect(shortJobError('')).toBeNull()
    expect(shortJobError(null)).toBeNull()
  })
})
