/**
 * GET /api/health reports only what it measures (shared with /intelligence via
 * lib/health/platform.ts): database round-trip and configuration completeness.
 * No made-up uptime, no names of missing variables.
 *
 * R4-A1 (readiness): on a persistent server also our Inngest (the ops-ping heartbeat in the journal)
 * and the in-process cron of this role (the journal of job outcomes), the variables that tie the
 * services together (counted with the configuration), every check bounded and the result cached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  dbFails: false,
  dbHangs: false,
  dbDelayMs: 0,
  missing: [] as string[],
  missingLinks: [] as string[],
  journalPresent: true,
  evidence: { last_cron: null as Date | null, role_since: null as Date | null, last_ping: null as Date | null },
  pingSince: null as Date | null,
  /** N5-1a: public.schema_migrations exists / holds the newest migration of the build. */
  schema: { journal: true, applied: true as boolean, latest: '157_crm_sync_catchup_lease_provenance.sql' as string | null, fails: false },
  queries: [] as string[],
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      state.queries.push(sql)
      if (state.dbFails) throw new Error('connection refused')
      if (state.dbHangs) return new Promise(() => {})
      if (state.dbDelayMs && sql.includes('SELECT 1')) await new Promise((r) => setTimeout(r, state.dbDelayMs))
      if (sql.includes('schema_migrations')) {
        if (state.schema.fails) throw new Error('permission denied for table schema_migrations')
        if (sql.includes('to_regclass')) return [{ journal: state.schema.journal }]
        return [{ applied: state.schema.applied, latest: state.schema.latest }]
      }
      if (sql.includes('to_regclass')) return [{ present: state.journalPresent, expectations: state.journalPresent }]
      if (sql.includes('ops_job_expectations')) return state.pingSince ? [{ since: state.pingSince }] : []
      if (sql.includes('last_cron')) return [state.evidence]
      return [{ '?column?': 1 }]
    },
  },
}))
vi.mock('@/lib/env', () => ({ getMissingServerEnv: () => state.missing, missingServiceLinkEnv: () => state.missingLinks }))

import { GET } from '@/app/api/health/route'
import { resetReadinessCache } from '@/lib/health/platform'
import { setWorkflowQueueStatus } from '@/lib/runtime/workflow-queue-status'

const QUEUE_STATUS_KEY = Symbol.for('aistart360.workflow.queue.status')

beforeEach(() => {
  state.dbFails = false
  state.dbHangs = false
  state.dbDelayMs = 0
  state.missing = []
  state.missingLinks = []
  state.journalPresent = true
  state.evidence = { last_cron: null, role_since: null, last_ping: null }
  state.pingSince = null
  state.schema = { journal: true, applied: true, latest: '157_crm_sync_catchup_lease_provenance.sql', fails: false }
  state.queries = []
  resetReadinessCache()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  delete (globalThis as Record<symbol, unknown>)[QUEUE_STATUS_KEY]
})

describe('GET /api/health', () => {
  it('all checks pass', async () => {
    const body = await (await GET()).json()
    expect(body.allOnline).toBe(true)
    expect(body.services.map((s: { name: string }) => s.name)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных'])
    expect(body.services.every((s: { uptime: string }) => s.uptime === 'не измеряется')).toBe(true)
  })

  it('missing configuration is counted, never named', async () => {
    state.missing = ['SUPABASE_SERVICE_ROLE_KEY', 'GIGA_COOKIE_SECRET']
    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.allOnline).toBe(false)
    expect(body.missingEnvCount).toBe(2)
    expect(text).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('a failed database round-trip is reported offline', async () => {
    state.dbFails = true
    const body = await (await GET()).json()
    expect(body.services[0]).toMatchObject({ name: 'База данных', status: 'offline' })
    expect(body.allOnline).toBe(false)
  })
})

describe('GET /api/health: the Workflow queue of a persistent server', () => {
  const names = (body: { services: { name: string }[] }) => body.services.map((s) => s.name)
  const queueOf = (body: { services: { name: string; status: string }[] }) => body.services.find((s) => s.name === 'Очередь Workflow')

  it('on Vercel (no PERSISTENT_SERVER) no queue entry, whatever the queue status says (the schema entry is on every server)', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '')
    setWorkflowQueueStatus({ state: 'retrying', attempts: 3, lastError: 'ECONNREFUSED' })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных'])
    expect(Object.keys(body.checks)).toEqual(['db', 'config', 'schema'])
    expect(body.allOnline).toBe(true)
    expect(body.summary).toBe('Все проверки пройдены')
  })

  it('PERSISTENT_SERVER=0 is not a persistent server either', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '0')
    const body = await (await GET()).json()
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных'])
  })

  it('a running queue is an online entry and everything passes', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    setWorkflowQueueStatus({ state: 'running', attempts: 1 })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных', 'Очередь Workflow'])
    expect(queueOf(body)).toMatchObject({ status: 'online', latencyMs: 0, uptime: 'не измеряется' })
    expect(body.checks).toMatchObject({ db: 'ok', config: 'ok', queue: 'ok' })
    expect(body.allOnline).toBe(true)
  })

  it('a queue still on its first attempt is degraded, not a failure', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    setWorkflowQueueStatus({ state: 'starting', attempts: 1 })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(queueOf(body)).toMatchObject({ status: 'degraded' })
    expect(body.checks.queue).toBe('ok')
    expect(body.allOnline).toBe(false)
    expect(body.summary).toMatch(/Очередь Workflow/)
  })

  it('a queue that keeps failing to start is offline and fails the check (503), without the error text', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    setWorkflowQueueStatus({ state: 'retrying', attempts: 4, lastError: 'getaddrinfo ENOTFOUND workflow-db.railway.internal' })

    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)

    expect(res.status).toBe(503)
    expect(queueOf(body)).toMatchObject({ status: 'offline' })
    expect(body.checks.queue).toBe('fail')
    expect(body.ok).toBe(false)
    expect(body.summary).toMatch(/Очередь Workflow/)
    // public endpoint: internal host names stay in the server log
    expect(text).not.toContain('workflow-db.railway.internal')
  })

  it('no queue at all on a persistent server (no Postgres world) is offline and fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(queueOf(body)).toMatchObject({ status: 'offline' })
    expect(body.checks.queue).toBe('fail')
  })

  it('the configuration and database summaries still win over the queue one', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    setWorkflowQueueStatus({ state: 'retrying', attempts: 2 })
    state.dbFails = true
    expect((await (await GET()).json()).summary).toMatch(/База данных/)
    state.missing = ['X']
    resetReadinessCache()
    expect((await (await GET()).json()).summary).toMatch(/Конфигурация/)
  })
})

// The agents service (PORTAL_ROLE=agents) is a persistent server too, but it does not start the
// Workflow queue (lib/runtime/server-start.ts): a queue that is "off" is how it is meant to run.
describe('GET /api/health: the agents service has no Workflow queue', () => {
  const names = (body: { services: { name: string }[] }) => body.services.map((s) => s.name)

  it('no «Очередь Workflow» entry, and the check passes when the database and the configuration do', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')

    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных'])
    expect(Object.keys(body.checks)).toEqual(['db', 'config', 'schema'])
    expect(body.allOnline).toBe(true)
    expect(body.degradedCount).toBe(0)
    expect(body.summary).toBe('Все проверки пройдены')
    expect(text).not.toContain('Workflow')
  })

  it('whatever the queue status says, it is not this service that runs the queue', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', ' Agents ')
    setWorkflowQueueStatus({ state: 'retrying', attempts: 9, lastError: 'ECONNREFUSED' })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных'])
    expect(body.ok).toBe(true)
  })

  it('a failed database round-trip still fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    state.dbFails = true

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks).toEqual({ db: 'fail', config: 'ok', schema: 'unknown' })
    expect(body.summary).toMatch(/База данных/)
  })

  it('an incomplete configuration still fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    state.missing = ['DATABASE_URL']

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks).toEqual({ db: 'ok', config: 'fail', schema: 'ok' })
    expect(body.summary).toMatch(/Конфигурация/)
  })

  it('the web role is the portal: its queue entry stays, and a queue that is off still fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'web')

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных', 'Очередь Workflow'])
    expect(body.checks.queue).toBe('fail')

    setWorkflowQueueStatus({ state: 'running', attempts: 1 })
    expect((await GET()).status).toBe(200)
  })

  it('an unknown PORTAL_ROLE is the portal too', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'worker')
    setWorkflowQueueStatus({ state: 'running', attempts: 1 })

    const body = await (await GET()).json()

    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных', 'Очередь Workflow'])
  })

  it('off Railway the role changes nothing: no queue entry either way', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    expect(names(await (await GET()).json())).toEqual(['База данных', 'Конфигурация сервера', 'Схема базы данных'])
  })
})

describe('GET /api/health: readiness of the background work (R4-A1)', () => {
  const MIN = 60_000
  const ago = (ms: number) => new Date(Date.now() - ms)
  const entry = (body: { services: { name: string; status: string }[] }, name: string) => body.services.find((s) => s.name === name)
  const portal = () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'web')
    setWorkflowQueueStatus({ state: 'running', attempts: 1 })
  }

  it('the cron of this role called something within 15 minutes: «Задачи по расписанию» online, 200', async () => {
    portal()
    vi.stubEnv('CRON_RUNNER_ENABLED', '1')
    state.evidence = { last_cron: ago(4 * MIN), last_ping: null, role_since: ago(3 * 24 * 60 * MIN) }

    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(entry(body, 'Задачи по расписанию')).toMatchObject({ status: 'online' })
    expect(body.checks.jobs).toBe('ok')
    // the query asks for this role's cron rows only
    expect(state.queries.some((q) => q.includes('service = ?'))).toBe(true)
  })

  it('a cron that has been silent for longer fails the check (503) without any detail of the jobs', async () => {
    portal()
    vi.stubEnv('CRON_RUNNER_ENABLED', '1')
    state.evidence = { last_cron: ago(40 * MIN), last_ping: null, role_since: ago(3 * 24 * 60 * MIN) }

    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)
    expect(res.status).toBe(503)
    expect(body.checks.jobs).toBe('fail')
    expect(body.summary).toMatch(/Задачи по расписанию/)
    expect(text).not.toContain('/api/cron')
    expect(text).not.toContain('ops_job_runs')
  })

  it('no evidence yet (a young journal, or no migration 154) is «degraded», never a failure', async () => {
    portal()
    vi.stubEnv('CRON_RUNNER_ENABLED', '1')
    state.evidence = { last_cron: null, last_ping: null, role_since: ago(5 * MIN) }
    let res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).checks.jobs).toBe('unknown')

    resetReadinessCache()
    state.journalPresent = false
    res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(entry(body, 'Задачи по расписанию')).toMatchObject({ status: 'degraded' })
  })

  it('our Inngest: the ops-ping heartbeat younger than 30 minutes is online, older fails the check', async () => {
    portal()
    vi.stubEnv('INNGEST_SELF_HOSTED_URL', 'http://inngest.railway.internal:8288')
    state.evidence = { last_cron: null, last_ping: ago(9 * MIN), role_since: ago(3 * 24 * 60 * MIN) }
    let body = await (await GET()).json()
    expect(entry(body, 'Фоновые задачи (Inngest)')).toMatchObject({ status: 'online' })
    expect(body.checks.inngest).toBe('ok')
    expect(body.checks).not.toHaveProperty('jobs') // CRON_RUNNER_ENABLED is not set here

    resetReadinessCache()
    state.evidence = { last_cron: null, last_ping: ago(45 * MIN), role_since: ago(3 * 24 * 60 * MIN) }
    const res = await GET()
    body = await res.json()
    expect(res.status).toBe(503)
    expect(body.checks.inngest).toBe('fail')
    expect(body.summary).toMatch(/Inngest/)
  })

  // RB-2 for readiness: «no ping at all» is judged from when the watchdog started to expect it.
  it('no ping yet: unknown while ops-ping is new (not expected, or expected for under 30 min), a failure after', async () => {
    portal()
    vi.stubEnv('INNGEST_SELF_HOSTED_URL', 'http://inngest.railway.internal:8288')
    state.evidence = { last_cron: null, role_since: ago(30 * 24 * 60 * MIN), last_ping: null }
    let res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).checks.inngest).toBe('unknown')

    resetReadinessCache()
    state.pingSince = ago(10 * MIN)
    expect((await (await GET()).json()).checks.inngest).toBe('unknown')

    resetReadinessCache()
    state.pingSince = ago(40 * MIN)
    res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks.inngest).toBe('fail')
  })

  it('no cron call of this role in a day: a failure once the role has older rows, unknown for a new role', async () => {
    portal()
    vi.stubEnv('CRON_RUNNER_ENABLED', '1')
    state.evidence = { last_cron: null, role_since: ago(40 * MIN), last_ping: null }
    expect((await (await GET()).json()).checks.jobs).toBe('fail')
    resetReadinessCache()
    state.evidence = { last_cron: null, role_since: null, last_ping: null }
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(4 * 60) // a process 4 minutes up
    try {
      expect((await (await GET()).json()).checks.jobs).toBe('unknown')
    } finally {
      uptime.mockRestore()
    }
  })

  // NV-3: the runner is on, but not one row of this role in the journal: judged from the start of
  // this process (the check runs in the process whose cron it judges), not «unknown» forever.
  it('the cron is on and the role has no row at all: a failure once this process has been up for 15 min', async () => {
    portal()
    vi.stubEnv('CRON_RUNNER_ENABLED', '1')
    state.evidence = { last_cron: null, role_since: null, last_ping: null }
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(20 * 60)
    try {
      const res = await GET()
      const body = await res.json()
      expect(res.status).toBe(503)
      expect(body.checks.jobs).toBe('fail')
      expect(body.summary).toMatch(/Задачи по расписанию/)
    } finally {
      uptime.mockRestore()
    }
  })

  it('the agents service has no Inngest entry, whatever the variables say', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    vi.stubEnv('INNGEST_SELF_HOSTED_URL', 'http://inngest.railway.internal:8288')
    const body = await (await GET()).json()
    expect(body.checks).not.toHaveProperty('inngest')
  })

  it('missing link variables count with the configuration (R-061), by number only', async () => {
    portal()
    state.missingLinks = ['AGENTS_SERVICE_URL', 'INNGEST_SELF_SIGNING_KEY']
    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)
    expect(res.status).toBe(503)
    expect(body.missingEnvCount).toBe(2)
    expect(body.checks.config).toBe('fail')
    expect(text).not.toContain('AGENTS_SERVICE_URL')
  })

  it('cached for 15 s: a burst of probes is one round of queries; after that it is measured again', async () => {
    portal()
    vi.stubEnv('CRON_RUNNER_ENABLED', '1')
    state.evidence = { last_cron: ago(MIN), last_ping: null, role_since: ago(60 * MIN) }
    await Promise.all([GET(), GET(), GET()])
    const first = state.queries.length
    await GET()
    expect(state.queries.length).toBe(first)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 16_000)
    await GET()
    expect(state.queries.length).toBeGreaterThan(first)
  })

  // RB-6: the agents service turns two 503s in a row into a CRITICAL; a slow answer (a queue for the
  // Prisma pool) is «degraded», only an error or no answer within 3 s fails the database.
  it('a slow database (≥ 400 ms) is degraded, not a failure: 200 and checks.db ok', async () => {
    state.dbDelayMs = 450
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.checks.db).toBe('ok')
    expect(body.services[0]).toMatchObject({ name: 'База данных', status: 'degraded' })
    expect(body.allOnline).toBe(false)
    expect(body.summary).toMatch(/База данных/)
  })

  it('a database that hangs is offline after 3 s, not waited for', async () => {
    vi.useFakeTimers()
    state.dbHangs = true
    const pending = GET()
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await pending
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.checks.db).toBe('fail')
  })
})

// N5-1a: the code went out without its migrations (main ahead of the database) — readiness says so.
describe('GET /api/health: the database schema matches the build (N5-1a)', () => {
  const entry = (body: { services: { name: string; status: string }[] }) => body.services.find((s) => s.name === 'Схема базы данных')

  it('the newest migration of the build is in schema_migrations: schema ok, 200', async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.checks.schema).toBe('ok')
    expect(entry(body)).toMatchObject({ status: 'online', latencyMs: 0, uptime: 'не измеряется' })
    // it asks for exactly the file the build ships
    expect(state.queries.some((q) => q.includes('FROM public.schema_migrations') && q.includes('file = ?'))).toBe(true)
  })

  it('not recorded: schema fail, 503, «schema behind» and not one file name in the public answer', async () => {
    state.schema.applied = false
    state.schema.latest = '154_ops_job_runs.sql'
    const res = await GET()
    const text = await res.text()
    const body = JSON.parse(text)
    expect(res.status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.checks.schema).toBe('fail')
    expect(entry(body)).toMatchObject({ status: 'offline' })
    expect(body.summary).toMatch(/Схема базы отстаёт от кода/)
    expect(text).not.toMatch(/\d{3}_[a-z0-9_]+\.sql/)
    expect(text).not.toContain('schema_migrations')
  })

  it('no journal table at all is a database that predates the journal: fail too', async () => {
    state.schema.journal = false
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks.schema).toBe('fail')
  })

  it('a journal that cannot be read while the database answers is unknown (degraded), not a failure', async () => {
    state.schema.fails = true
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.checks.schema).toBe('unknown')
    expect(entry(body)).toMatchObject({ status: 'degraded' })
  })

  it('the database and configuration summaries still win; schema wins over the queue', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    setWorkflowQueueStatus({ state: 'retrying', attempts: 2 })
    state.schema.applied = false
    expect((await (await GET()).json()).summary).toMatch(/Схема базы/)
    resetReadinessCache()
    state.dbFails = true
    expect((await (await GET()).json()).summary).toMatch(/База данных/)
  })

  it('also on the agents service (same build, same database)', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    state.schema.applied = false
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks).toEqual({ db: 'ok', config: 'ok', schema: 'fail' })
  })
})
