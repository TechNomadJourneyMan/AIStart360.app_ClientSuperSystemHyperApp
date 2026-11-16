/**
 * lib/ops/job-watchdog.ts — the job watchdog (R4-A1): the journal of job outcomes against the
 * schedule (×2, never less than the interval + 15 min), the Point A queue, the monitoring checks
 * without the «Агенты 24/7» switch, demo accounts, the agents service and «nowhere to alert».
 * Pure parts and the pass with stub dependencies; the real database is in
 * tests/integration/db/ops-job-runs.test.ts.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetWatchdogStreaks,
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
  /** `expectedAgeMs`: since when every job has been expected (ops_job_expectations); null — never noted. */
  const state = (rows: Array<[string, number, JobStatus[]]>, expectedAgeMs: number | null = 40 * 24 * H, expected?: ExpectedJob[]): JobsState => {
    const list = expected ?? [job('/api/cron/expert-sla', '*/5 * * * *'), job('/api/cron/billing-expiry', '15 0 * * *'), job('inngest:ops-ping', '*/10 * * * *')]
    return {
      expected: list,
      last: new Map(rows.map(([j, minutesAgo, statuses]) => [j, { job: j, status: statuses[0], finishedAt: new Date(now.getTime() - minutesAgo * MIN), httpStatus: statuses[0] === 'http_error' ? 500 : 200, error: statuses[0] === 'ok' ? null : 'HTTP 500' }])),
      recent: new Map(rows.map(([j, , statuses]) => [j, statuses])),
      expectedSince: new Map(expectedAgeMs === null ? [] : list.map((e) => [e.job, new Date(now.getTime() - expectedAgeMs)])),
    }
  }

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

  it('never in the journal: waiting while it is expected for a short time, a problem once longer than the allowed age', () => {
    const young = assessJobs(state([], 10 * MIN), now)
    expect(young.problems).toEqual([])
    expect(young.views.every((v) => v.health === 'waiting')).toBe(true)

    const old = assessJobs(state([['/api/cron/billing-expiry', 60, ['ok']]], 3 * H), now)
    expect(old.problems.map((p) => p.key)).toEqual(['job:never:/api/cron/expert-sla', 'job:never:inngest:ops-ping'])
    expect(old.problems[1].lines.join(' ')).toMatch(/inngest/)
  })

  // RB-2: «never» counts from when the job became expected, not from the age of the journal.
  it('a job new in this release (not noted before) in a 30-day-old journal is waiting, not «never»', () => {
    const daily = job('/api/cron/new-daily', '0 6 * * *')
    const s = state([['/api/cron/expert-sla', 2, ['ok']]], 40 * 24 * H, [job('/api/cron/expert-sla', '*/5 * * * *'), daily])
    s.expectedSince.set('/api/cron/new-daily', new Date(now.getTime() - 10 * MIN)) // first expected by this pass
    const res = assessJobs(s, now)
    expect(res.problems).toEqual([])
    expect(res.views.find((v) => v.job === '/api/cron/new-daily')?.health).toBe('waiting')
    // not noted at all (a read-only view before the watchdog's first pass): waiting too
    s.expectedSince.delete('/api/cron/new-daily')
    expect(assessJobs(s, now).problems).toEqual([])
    // expected for 49 h and never run: now it is a problem
    s.expectedSince.set('/api/cron/new-daily', new Date(now.getTime() - 49 * H))
    expect(assessJobs(s, now).problems.map((p) => p.key)).toEqual(['job:never:/api/cron/new-daily'])
  })

  // RB-3: a rare job's last outcome counts however old it is (the journal keeps it past 30 days).
  it('a monthly job whose last run (35 days ago) failed is «failing», not «ok»', () => {
    const monthly = job('inngest:pb-monthly-checkpoint', '0 4 1 * *')
    const res = assessJobs(state([['inngest:pb-monthly-checkpoint', 35 * 24 * 60, ['error']]], 60 * 24 * H, [monthly]), now)
    // the window of recent outcomes is 8 days: it is empty for this job
    const s = state([['inngest:pb-monthly-checkpoint', 35 * 24 * 60, ['error']]], 60 * 24 * H, [monthly])
    s.recent.clear()
    expect(assessJobs(s, now).problems.map((p) => [p.key, p.level])).toEqual([['job:failing:inngest:pb-monthly-checkpoint', 'WARNING']])
    expect(res.views[0].health).toBe('failing')
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

  it('alerts go nowhere only with no linked Super Admin AND no env chat a bot can reach', () => {
    expect(assessAlertRoutes({ linkedStaff: 0, envChats: 0, direct: false }).map((p) => p.key)).toEqual(['alerts:nowhere'])
    expect(assessAlertRoutes({ linkedStaff: 1, envChats: 0, direct: false })).toEqual([])
    expect(assessAlertRoutes({ linkedStaff: 0, envChats: 1, direct: true })).toEqual([])
    // RB-1: chats in TELEGRAM_ADMIN_CHAT_IDS without a bot token reach nobody
    expect(assessAlertRoutes({ linkedStaff: 0, envChats: 2, direct: false }).map((p) => p.key)).toEqual(['alerts:nowhere'])
  })
})

describe('runJobWatchdog', () => {
  const now = new Date('2026-11-16T12:00:00Z')
  beforeEach(() => resetWatchdogStreaks())

  function deps(over: Partial<WatchdogDeps> = {}) {
    const sent: Array<{ key: string; remind: number }> = []
    const direct: WatchProblem[] = []
    const d: WatchdogDeps = {
      role: () => 'web',
      inngestCrons: async () => [],
      loadJobs: async (expected) => ({ expected, last: new Map(), recent: new Map(), expectedSince: new Map() }),
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
    expect(await runJobWatchdog(now, t.d)).toEqual({ status: 'ok', journal: 'ok', problems: [], notified: [], undelivered: [], failedChecks: [], pruned: { jobRuns: 0, cronRuns: 0 } })
    expect(t.sent).toEqual([])
  })

  it('problems are sent once per key: a recent alert keeps it quiet; «nowhere» reminds every 24 h', async () => {
    const t = deps({
      alertRoutes: async () => ({ linkedStaff: 0, envChats: 0, direct: false }),
      agentsService: async () => ({ ok: false, detail: 'нет ответа за 5 с' }),
      lastAlertAt: async (key) => (key === 'agents:down' ? new Date(now.getTime() - 2 * H) : null),
    })
    await runJobWatchdog(now, t.d) // the first failed probe of the agents service: not yet an alarm
    t.sent.length = 0
    const report = await runJobWatchdog(now, t.d)
    expect(report.problems).toEqual(['alerts:nowhere', 'agents:down'])
    expect(report.notified).toEqual(['alerts:nowhere'])
    expect(report.status).toBe('alerted')
    expect(t.sent).toEqual([{ key: 'alerts:nowhere', remind: 24 }])
  })

  // RB-5: one failed probe (a restart of the service) is not an outage.
  it('the agents service: CRITICAL only on the second failed pass in a row; a good pass in between resets it', async () => {
    let ok = false
    const t = deps({ agentsService: async () => ({ ok, detail: ok ? 'HTTP 200' : 'нет ответа за 5 с' }) })
    expect((await runJobWatchdog(now, t.d)).problems).toEqual([])
    ok = true
    expect((await runJobWatchdog(now, t.d)).problems).toEqual([])
    ok = false
    expect((await runJobWatchdog(now, t.d)).problems).toEqual([])
    const second = await runJobWatchdog(now, t.d)
    expect(second.problems).toEqual(['agents:down'])
    expect(t.sent.map((s) => s.key)).toEqual(['agents:down'])
  })

  // RB-4: one alert that cannot be sent does not stop the others or the retention.
  it('an alert that fails to send is named; the other alerts (CRITICAL too) go, and the retention runs', async () => {
    const prune = vi.fn(async () => ({ jobRuns: 3, cronRuns: 1 }))
    const sentKeys: string[] = []
    const t = deps({
      pointAQueue: async () => ({ due: 9, overdue: 2, oldestOverdueMinutes: 90 }),
      platformChecks: async () => [{ key: 'agent_stuck', label: 'Агенты: зависшие задачи', status: 'critical', value: 4, detail: 'x' }],
      lastAlertAt: async (key) => { if (key === 'pa_queue:overdue') throw new Error('connection reset'); return null },
      notify: async (p) => { sentKeys.push(p.key); return { sent: true } },
      prune,
    })
    const report = await runJobWatchdog(now, t.d)
    expect(report.failedChecks).toEqual(['notify:pa_queue:overdue'])
    expect(report.notified).toEqual(['platform:agent_stuck'])
    expect(sentKeys).toEqual(['platform:agent_stuck'])
    expect(prune).toHaveBeenCalledTimes(1)
    expect(report.pruned).toEqual({ jobRuns: 3, cronRuns: 1 })

    const throwing = deps({ platformChecks: async () => [{ key: 'a', label: 'A', status: 'warn', value: 1, detail: 'x' }, { key: 'b', label: 'B', status: 'critical', value: 1, detail: 'y' }],
      notify: async (p) => { if (p.key === 'platform:a') throw new Error('insert failed'); sentKeys.push(p.key); return { sent: true } } })
    const r2 = await runJobWatchdog(now, throwing.d)
    expect(r2.notified).toEqual(['platform:b'])
    expect(r2.failedChecks).toEqual(['notify:platform:a'])
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

  it('a database the watchdog cannot read: the pass fails; on the second pass in a row the alarm goes out directly (no database)', async () => {
    const t = deps({ loadJobs: async () => { throw new Error("Can't reach database server at postgres.railway.internal") } })
    await expect(runJobWatchdog(now, t.d)).rejects.toThrow(/reach database/)
    expect(t.direct).toEqual([]) // RB-5: one pool timeout is not an outage
    await expect(runJobWatchdog(now, t.d)).rejects.toThrow(/reach database/)
    expect(t.direct).toHaveLength(1)
    expect(t.direct[0]).toMatchObject({ key: 'watchdog:db', level: 'CRITICAL' })
    expect(t.sent).toEqual([])
  })

  it('a database that answers again resets the count; an alarm that fails does not hide the error', async () => {
    let fail = true
    const t = deps({
      loadJobs: async (expected) => { if (fail) throw new Error('pool timeout'); return { expected, last: new Map(), recent: new Map(), expectedSince: new Map() } },
      alertDirect: async () => { throw new Error('telegram down') },
    })
    await expect(runJobWatchdog(now, t.d)).rejects.toThrow(/pool timeout/)
    fail = false
    await runJobWatchdog(now, t.d)
    fail = true
    await expect(runJobWatchdog(now, t.d)).rejects.toThrow(/pool timeout/) // one in a row again: no alarm
    await expect(runJobWatchdog(now, t.d)).rejects.toThrow(/pool timeout/) // the alarm throws: still the db error
  })

  // NV-4: a pass whose alerts could not be sent is never a quiet «ok».
  it('alerts that could not be sent: status undelivered (the route answers 502), a direct alarm, and the rest of the pass still done', async () => {
    const prune = vi.fn(async () => ({ jobRuns: 1, cronRuns: 0 }))
    const t = deps({
      pointAQueue: async () => ({ due: 9, overdue: 2, oldestOverdueMinutes: 7 * 60 }), // CRITICAL
      demo: async () => ({ created24h: 50, olderThan48h: 0 }), // WARNING
      notify: async () => { throw new Error('insert into notification_events failed') },
      prune,
    })
    const report = await runJobWatchdog(now, t.d)
    expect(report.status).toBe('undelivered')
    expect(report.undelivered).toEqual(['pa_queue:overdue', 'demo:burst'])
    expect(report.notified).toEqual([])
    expect(prune).toHaveBeenCalledTimes(1)
    expect(t.direct).toHaveLength(1)
    expect(t.direct[0]).toMatchObject({ key: 'watchdog:undelivered', level: 'CRITICAL', title: 'Сторож задач не смог отправить тревоги' })
    expect(t.direct[0].lines.join(' ')).toContain('Не отправлено: 2')

    // one of two that fails is «undelivered» too; the one that went is still counted
    const partial = deps({
      demo: async () => ({ created24h: 50, olderThan48h: 3 }),
      notify: async (p) => { if (p.key === 'demo:stale') throw new Error('x'); return { sent: true } },
    })
    const r2 = await runJobWatchdog(now, partial.d)
    expect(r2).toMatchObject({ status: 'undelivered', notified: ['demo:burst'], undelivered: ['demo:stale'] })
    expect(partial.direct[0].level).toBe('WARNING')
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
        expectedSince: new Map(),
      }),
      alertRoutes: async () => ({ linkedStaff: 0, envChats: 0, direct: false }),
    })
    expect(overview.journal).toBe('ok')
    expect(overview.jobs.find((j) => j.job === 'inngest:ops-ping')).toMatchObject({ health: 'stale', label: expect.stringContaining('Inngest') })
    expect(overview.jobs.find((j) => j.job === '/api/cron/expert-sla')).toMatchObject({ health: 'waiting', lastAt: null })
    expect(overview.alertRoutes).toEqual({ linkedStaff: 0, envChats: 0, direct: false, nowhere: true })
  })

  // NV-4: the GIGA card sees the last pass of the watchdog that could not send its alerts.
  it('the last watchdog pass answered 502 (alerts not delivered): alertsUndeliveredAt; a 500 is not that', async () => {
    const { opsOverview, WATCHDOG_UNDELIVERED_HTTP } = await import('@/lib/ops/job-watchdog')
    const now = new Date('2026-11-16T12:00:00Z')
    const at = new Date(now.getTime() - 4 * MIN)
    const view = (httpStatus: number) => opsOverview(now, {
      role: () => 'all',
      inngestCrons: async () => [],
      loadJobs: async (expected) => ({
        expected,
        last: new Map([['/api/cron/ops-watchdog', { job: '/api/cron/ops-watchdog', status: 'http_error' as const, finishedAt: at, httpStatus, error: `HTTP ${httpStatus}` }]]),
        recent: new Map(),
        expectedSince: new Map(),
      }),
      alertRoutes: async () => ({ linkedStaff: 1, envChats: 0, direct: false }),
    })
    expect(WATCHDOG_UNDELIVERED_HTTP).toBe(502)
    expect((await view(502)).alertsUndeliveredAt).toBe(at.toISOString())
    expect((await view(500)).alertsUndeliveredAt).toBeNull()
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

// RB-10: the comments of the migration and its rollback say what the code really answers without the tables.
describe('migration 154: comments match the code', () => {
  const root = resolve(__dirname, '../../..')
  it('without the tables the watchdog answers 200 with journal = not_migrated (not a 503)', () => {
    for (const file of ['supabase/migrations/154_ops_job_runs.sql', 'supabase/migrations/rollback/154_ops_job_runs.down.sql']) {
      const text = readFileSync(resolve(root, file), 'utf8')
      expect(text, file).not.toMatch(/migration_154_required|отвечает 503|answers 503/)
      expect(text, file).toMatch(/not_migrated/)
    }
  })
})
