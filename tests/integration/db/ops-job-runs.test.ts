/**
 * R4-A1 on the real database: migration 154 (public.ops_job_runs) and everything that reads or
 * writes it.
 *
 *   • the table: RLS on without policies, nothing for anon / authenticated, the CHECKs;
 *   • the journal writer (lib/ops/job-journal.ts) on its own pg pool: a row per outcome, the role of
 *     the process, the error cut to its first line; a bad row is false and a log line, never a throw;
 *   • the watchdog (lib/ops/job-watchdog.ts) with its real queries and notifyStaff: a job past its
 *     allowed age → one CRITICAL to the Super Admin only (Telegram through a recording fetch), the next
 *     pass sends nothing; «nowhere to alert» when no staff member is linked; the demo accounts that
 *     are not cleaned up; the monitoring checks without «Агенты 24/7»; the retention of 30 days in
 *     ops_job_runs and in cron_runs (pruneCronRuns);
 *   • /api/health readiness reading the journal of its role.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('ops_job_runs (154)', async () => {
  const { prisma } = await import('@/lib/db')
  const { recordJobRun, journalQuery } = await import('@/lib/ops/job-journal')
  const watchdog = await import('@/lib/ops/job-watchdog')
  const { pruneCronRuns } = await import('@/lib/cron/claim')
  const { CREATE_CRON_RUNS_TABLE } = await import('@/lib/cron/cron-runs-table.mjs')
  const health = await import('@/lib/health/platform')

  const MIN = 60_000
  const H = 60 * MIN
  const sent: Array<{ chat: string; text: string }> = []
  const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (String(url).endsWith('/sendMessage')) sent.push({ chat: String(body.chat_id), text: String(body.text) })
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 })
  })

  const superAdmin = { id: randomUUID(), tg: 920_000_000 + Math.floor(Math.random() * 1e6) }
  const admin = { id: randomUUID(), tg: superAdmin.tg + 1 }
  const demoUser = { id: randomUUID(), email: `demo-${randomUUID().slice(0, 8)}@aistart360.app` }
  const env: Record<string, string | undefined> = {}
  let createdCronRuns = false

  async function linkedStaff(u: { id: string; tg: number }, role: string) {
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${u.id}::uuid, ${`${u.id}@staff.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET status = 'approved' WHERE id = ${u.id}::uuid`
    await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${u.id}::uuid, ${role})`
    await prisma.$executeRaw`
      INSERT INTO public.staff_telegram_links (user_id, telegram_user_id, chat_id, linked_at, min_level)
      VALUES (${u.id}::uuid, ${u.tg}, ${String(u.tg)}, now() - interval '1 day', 'WARNING')`
  }

  async function addRun(job: string, minutesAgo: number, status = 'ok', service = 'all', kind = job.startsWith('inngest:') ? 'inngest' : 'cron') {
    await prisma.$executeRaw`
      INSERT INTO public.ops_job_runs (job, kind, service, started_at, finished_at, duration_ms, status)
      VALUES (${job}, ${kind}, ${service}, now() - make_interval(secs => ${minutesAgo * 60 + 1}::double precision),
              now() - make_interval(secs => ${minutesAgo * 60}::double precision), 1000, ${status})`
  }

  /** Every job one process for everything expects, fresh and fine — the baseline of a healthy portal. */
  async function healthyJournal() {
    for (const e of watchdog.expectedJobs('all', [])) await addRun(e.job, 1)
    await addRun('/api/cron/billing-expiry', 40 * 24 * 60) // the journal is old enough for «never» to count
  }

  const events = () => prisma.$queryRaw<Array<{ level: string; problem: string }>>`
    SELECT level, data->>'problem' AS problem FROM public.notification_events WHERE type = 'ops.watchdog' ORDER BY created_at`

  /** The real dependencies, except what reaches outside the database (Inngest schedule, the agents service). */
  const deps = (over: Partial<import('@/lib/ops/job-watchdog').WatchdogDeps> = {}) => ({
    ...watchdog.defaultDeps,
    role: () => 'all' as const,
    inngestCrons: async () => [],
    agentsService: async () => null,
    platformChecks: async () => [],
    ...over,
  })

  beforeAll(async () => {
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_BOT_TOKEN', 'NOTIFY_QUIET_HOURS', 'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL', 'PORTAL_ROLE', 'WORKFLOW_POSTGRES_URL']) env[k] = process.env[k]
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    delete process.env.TELEGRAM_ADMIN_BOT_TOKEN
    process.env.NOTIFY_QUIET_HOURS = ''
    process.env.TELEGRAM_ADMIN_CHAT_IDS = ''
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.ADMIN_NOTIFICATION_EMAIL
    delete process.env.ADMIN_EMAIL
    delete process.env.PORTAL_ROLE
    delete process.env.WORKFLOW_POSTGRES_URL
    vi.stubGlobal('fetch', fakeFetch)
    await linkedStaff(superAdmin, 'super_admin')
    await linkedStaff(admin, 'admin')
    const [{ t }] = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('public.cron_runs')::text AS t`
    if (!t) {
      await prisma.$executeRawUnsafe(CREATE_CRON_RUNS_TABLE)
      createdCronRuns = true
    }
  })

  beforeEach(async () => {
    sent.length = 0
    await prisma.$executeRaw`DELETE FROM public.ops_job_runs`
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE type = 'ops.watchdog'`
    health.resetReadinessCache()
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma.$executeRaw`DELETE FROM public.ops_job_runs`
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE type = 'ops.watchdog'`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id IN (${superAdmin.id}::uuid, ${admin.id}::uuid, ${demoUser.id}::uuid)`
    if (createdCronRuns) await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS public.cron_runs')
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await prisma.$disconnect()
  })

  it('the table: RLS on without policies, nothing for anon / authenticated, service_role may write, CHECKs hold', async () => {
    const [t] = await prisma.$queryRaw<Array<{ rls: boolean }>>`SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.ops_job_runs'::regclass`
    expect(t.rls).toBe(true)
    const privs = await prisma.$queryRaw<Array<{ role: string; any: boolean }>>`
      SELECT r AS role,
             has_table_privilege(r, 'public.ops_job_runs', 'SELECT')
          OR has_table_privilege(r, 'public.ops_job_runs', 'INSERT')
          OR has_table_privilege(r, 'public.ops_job_runs', 'UPDATE')
          OR has_table_privilege(r, 'public.ops_job_runs', 'DELETE') AS any
      FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r`
    expect(Object.fromEntries(privs.map((p) => [p.role, p.any]))).toEqual({ anon: false, authenticated: false, service_role: true })
    const [policies] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ops_job_runs'`
    expect(Number(policies.n)).toBe(0)
    await expect(prisma.$executeRaw`INSERT INTO public.ops_job_runs (job, kind, service, started_at, status) VALUES ('x', 'cron', 'all', now(), 'bogus')`).rejects.toThrow()
    await expect(prisma.$executeRaw`INSERT INTO public.ops_job_runs (job, kind, service, started_at, status) VALUES ('x', 'cron', 'portal', now(), 'ok')`).rejects.toThrow()
    await expect(prisma.$executeRaw`INSERT INTO public.ops_job_runs (job, kind, service, started_at, status, error) VALUES ('x', 'cron', 'all', now(), 'ok', ${'e'.repeat(501)})`).rejects.toThrow()
  })

  it('recordJobRun: one row per outcome on its own pool, the role of the process, the error cut to its first line', async () => {
    const log: string[] = []
    const ok = await recordJobRun(
      { job: '/api/cron/expert-sla', kind: 'cron', scheduledFor: new Date('2026-11-16T10:05:00Z'), startedAt: new Date(Date.now() - 1500), status: 'http_error', httpStatus: 500, error: `HTTP 500\n${'stack '.repeat(100)}` },
      { role: 'web', log: (l) => log.push(l) },
    )
    expect(ok).toBe(true)
    const [row] = await prisma.$queryRaw<Array<{ job: string; kind: string; service: string; status: string; http_status: number; error: string; duration_ms: number; scheduled_for: Date }>>`
      SELECT job, kind, service, status, http_status, error, duration_ms, scheduled_for FROM public.ops_job_runs`
    expect(row).toMatchObject({ job: '/api/cron/expert-sla', kind: 'cron', service: 'web', status: 'http_error', http_status: 500, error: 'HTTP 500' })
    expect(row.duration_ms).toBeGreaterThanOrEqual(1500)
    expect(row.scheduled_for.toISOString()).toBe('2026-11-16T10:05:00.000Z')

    const long = await recordJobRun({ job: 'inngest:x', kind: 'inngest', startedAt: new Date(), status: 'error', error: 'z'.repeat(1000) }, { log: (l) => log.push(l) })
    expect(long).toBe(true)
    const [{ len }] = await prisma.$queryRaw<Array<{ len: number }>>`SELECT length(error) AS len FROM public.ops_job_runs WHERE job = 'inngest:x'`
    expect(len).toBe(300)
    expect(log).toEqual([])
  })

  it('recordJobRun never throws: a row the table refuses is false and one log line', async () => {
    const log: string[] = []
    const res = await recordJobRun({ job: 'x', kind: 'cron', startedAt: new Date(), status: 'nope' as never }, { log: (l) => log.push(l) })
    expect(res).toBe(false)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(/журнал задач/)
    // and a journal query of its own pool still works afterwards
    const q = journalQuery()!
    expect((await q('SELECT 1 AS one', [])).rows).toEqual([{ one: 1 }])
  })

  it('a healthy journal: the watchdog finds nothing about the jobs', async () => {
    await healthyJournal()
    const report = await watchdog.runJobWatchdog(new Date(), deps())
    expect(report.journal).toBe('ok')
    expect(report.problems.filter((p) => p.startsWith('job:'))).toEqual([])
  })

  it('a job past its allowed age: one CRITICAL to the Super Admin only; the next pass sends nothing', async () => {
    await healthyJournal()
    await prisma.$executeRaw`DELETE FROM public.ops_job_runs WHERE job = '/api/cron/expert-sla'`
    await addRun('/api/cron/expert-sla', 35)

    const first = await watchdog.runJobWatchdog(new Date(), deps())
    expect(first.problems).toContain('job:stale:/api/cron/expert-sla')
    expect(first.notified).toContain('job:stale:/api/cron/expert-sla')
    const stale = sent.filter((s) => s.text.includes('давно не запускалась'))
    expect(stale.map((s) => s.chat)).toEqual([String(superAdmin.tg)])
    expect(stale[0].text).toContain('SLA экспертов')
    expect(await events()).toContainEqual({ level: 'CRITICAL', problem: 'job:stale:/api/cron/expert-sla' })

    const again = await watchdog.runJobWatchdog(new Date(Date.now() + 10 * MIN), deps())
    expect(again.problems).toContain('job:stale:/api/cron/expert-sla')
    expect(again.notified).not.toContain('job:stale:/api/cron/expert-sla')
    expect(sent.filter((s) => s.text.includes('давно не запускалась'))).toHaveLength(1)
  })

  it('a job whose last three calls failed is a WARNING with the HTTP code', async () => {
    await healthyJournal()
    await prisma.$executeRaw`DELETE FROM public.ops_job_runs WHERE job = '/api/cron/expert-sla'`
    for (const m of [12, 7, 2]) await addRun('/api/cron/expert-sla', m, 'http_error')
    await prisma.$executeRaw`UPDATE public.ops_job_runs SET http_status = 500, error = 'HTTP 500' WHERE job = '/api/cron/expert-sla'`
    // a claim that failed later is not a call: it does not hide the failures
    await addRun('/api/cron/expert-sla', 1, 'claim_failed')

    const report = await watchdog.runJobWatchdog(new Date(), deps())
    expect(report.problems).toContain('job:failing:/api/cron/expert-sla')
    expect(sent.find((s) => s.text.includes('завершается ошибкой'))?.text).toContain('HTTP 500')
  })

  it('nobody linked and no TELEGRAM_ADMIN_CHAT_IDS: «тревогам некуда приходить» in the feed', async () => {
    await healthyJournal()
    const routes = await watchdog.loadAlertRoutes()
    expect(routes.linkedStaff).toBeGreaterThanOrEqual(2)
    const report = await watchdog.runJobWatchdog(new Date(), deps({ alertRoutes: async () => ({ linkedStaff: 0, envChats: 0, direct: false }) }))
    expect(report.problems).toContain('alerts:nowhere')
    expect(await events()).toContainEqual({ level: 'WARNING', problem: 'alerts:nowhere' })
  })

  it('demo accounts older than 48 h (the cleanup does not run) are a WARNING', async () => {
    await healthyJournal()
    await prisma.$executeRaw`
      INSERT INTO auth.users (id, email, raw_app_meta_data, created_at)
      VALUES (${demoUser.id}::uuid, ${demoUser.email}, '{"demo": true}'::jsonb, now() - interval '3 days')`
    const report = await watchdog.runJobWatchdog(new Date(), deps())
    expect(report.problems).toContain('demo:stale')
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${demoUser.id}::uuid`
  })

  it('Point A queue: the nightly wave (deep, due now or soon) is no alarm; a row overdue 2 h that nobody works on is', async () => {
    const ids = Array.from({ length: 4 }, () => `ops-test-${randomUUID()}`)
    try {
      for (const id of ids) await prisma.$executeRaw`INSERT INTO public.companies (id, name, "updatedAt") VALUES (${id}, 'ТОО Сторож', now())`
      // the nightly wave: due in the past few minutes and in the next hour
      await prisma.$executeRaw`INSERT INTO public.point_a_recalc_queue (company_id, reasons, due_at) VALUES (${ids[0]}, ARRAY['nightly'], now() - interval '3 minutes')`
      await prisma.$executeRaw`INSERT INTO public.point_a_recalc_queue (company_id, reasons, due_at) VALUES (${ids[1]}, ARRAY['nightly'], now() + interval '40 minutes')`
      // overdue for two hours but claimed a minute ago: in progress, not stuck
      await prisma.$executeRaw`INSERT INTO public.point_a_recalc_queue (company_id, reasons, due_at, started_at) VALUES (${ids[2]}, ARRAY['nightly'], now() - interval '2 hours', now() - interval '1 minute')`
      let q = await watchdog.defaultDeps.pointAQueue()
      expect(q).toMatchObject({ due: 2, overdue: 0, oldestOverdueMinutes: null })
      expect(watchdog.assessPointAQueue(q)).toEqual([])

      await prisma.$executeRaw`INSERT INTO public.point_a_recalc_queue (company_id, reasons, due_at) VALUES (${ids[3]}, ARRAY['survey'], now() - interval '2 hours')`
      q = await watchdog.defaultDeps.pointAQueue()
      expect(q.overdue).toBe(1)
      expect(q.oldestOverdueMinutes).toBeGreaterThanOrEqual(119)
      expect(watchdog.assessPointAQueue(q)[0]).toMatchObject({ key: 'pa_queue:overdue', level: 'WARNING' })
    } finally {
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ANY (${ids}::text[])`
    }
  })

  it('the monitoring checks run in the watchdog itself (N4A-7): the real snapshot answers on this database', async () => {
    const checks = await watchdog.defaultDeps.platformChecks()
    expect(checks.map((c) => c.key)).toEqual(expect.arrayContaining(['agent_backlog', 'agent_stuck', 'documents_stuck', 'ai_spend_today']))
  })

  it('retention: ops_job_runs and cron_runs older than 30 days go, younger rows stay', async () => {
    await addRun('/api/cron/reminders', 31 * 24 * 60)
    await addRun('/api/cron/reminders', 29 * 24 * 60)
    await prisma.$executeRawUnsafe(`DELETE FROM public.cron_runs WHERE path LIKE '/test/%'`)
    await prisma.$executeRawUnsafe(`INSERT INTO public.cron_runs (path, minute) VALUES
      ('/test/old', now() - interval '31 days'), ('/test/young', now() - interval '29 days')`)

    process.env.WORKFLOW_POSTGRES_URL = process.env.DATABASE_URL
    try {
      const report = await watchdog.runJobWatchdog(new Date(), deps())
      expect(report.pruned.jobRuns).toBe(1)
      expect(report.pruned.cronRuns).toBeGreaterThanOrEqual(1)
    } finally {
      delete process.env.WORKFLOW_POSTGRES_URL
    }
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM public.ops_job_runs WHERE job = '/api/cron/reminders'`
    expect(Number(n)).toBe(1)
    const left = await prisma.$queryRawUnsafe<Array<{ path: string }>>(`SELECT path FROM public.cron_runs WHERE path LIKE '/test/%'`)
    expect(left.map((r) => r.path)).toEqual(['/test/young'])

    // a database without the table is 0, not an error
    expect(await pruneCronRuns(process.env.DATABASE_URL!, 30, 10, {
      client: { connect: async () => {}, end: async () => {}, query: async () => { throw Object.assign(new Error('relation "cron_runs" does not exist'), { code: '42P01' }) } } as never,
    })).toBe(0)
  })

  it('/api/health readiness reads the journal of its own role', async () => {
    const saved = { ...process.env }
    try {
      process.env.PERSISTENT_SERVER = '1'
      process.env.PORTAL_ROLE = 'web'
      process.env.CRON_RUNNER_ENABLED = '1'
      process.env.INNGEST_SELF_HOSTED_URL = 'http://inngest.railway.internal:8288'
      await addRun('/api/cron/billing-expiry', 3 * 24 * 60, 'ok', 'web')
      await addRun('/api/cron/agents', 1, 'ok', 'agents') // another role does not count
      await addRun('inngest:ops-ping', 50, 'ok', 'web')
      let r = await health.checkReadiness()
      expect(r.jobs).toBe('fail')
      expect(r.inngest).toBe('fail')

      health.resetReadinessCache()
      await addRun('/api/cron/expert-sla', 2, 'ok', 'web')
      await addRun('/api/cron/ops-watchdog', 1, 'claim_failed', 'web') // a failed claim is not a call
      await addRun('inngest:ops-ping', 5, 'ok', 'web')
      r = await health.checkReadiness()
      expect(r.jobs).toBe('ok')
      expect(r.inngest).toBe('ok')
    } finally {
      for (const k of ['PERSISTENT_SERVER', 'PORTAL_ROLE', 'CRON_RUNNER_ENABLED', 'INNGEST_SELF_HOSTED_URL']) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    }
  })

  it('the journal pool is one connection named for the journal', async () => {
    const q = journalQuery()!
    await q('SELECT 1', [])
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    try {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'aistart360-ops-journal'`)
      expect(rows[0].n).toBeLessThanOrEqual(1)
    } finally {
      await pool.end()
    }
  })
})
