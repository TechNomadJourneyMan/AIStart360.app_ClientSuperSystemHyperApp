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
  missing: [] as string[],
  missingLinks: [] as string[],
  journalPresent: true,
  evidence: { last_cron: null as Date | null, last_ping: null as Date | null, since: null as Date | null },
  queries: [] as string[],
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      state.queries.push(sql)
      if (state.dbFails) throw new Error('connection refused')
      if (state.dbHangs) return new Promise(() => {})
      if (sql.includes('to_regclass')) return [{ present: state.journalPresent }]
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
  state.missing = []
  state.missingLinks = []
  state.journalPresent = true
  state.evidence = { last_cron: null, last_ping: null, since: null }
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
    expect(body.services.map((s: { name: string }) => s.name)).toEqual(['База данных', 'Конфигурация сервера'])
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

  it('on Vercel (no PERSISTENT_SERVER) the output is exactly as before, whatever the queue status says', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '')
    setWorkflowQueueStatus({ state: 'retrying', attempts: 3, lastError: 'ECONNREFUSED' })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера'])
    expect(Object.keys(body.checks)).toEqual(['db', 'config'])
    expect(body.allOnline).toBe(true)
    expect(body.summary).toBe('Все проверки пройдены')
  })

  it('PERSISTENT_SERVER=0 is not a persistent server either', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '0')
    const body = await (await GET()).json()
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера'])
  })

  it('a running queue is an online entry and everything passes', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    setWorkflowQueueStatus({ state: 'running', attempts: 1 })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Очередь Workflow'])
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
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера'])
    expect(Object.keys(body.checks)).toEqual(['db', 'config'])
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
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера'])
    expect(body.ok).toBe(true)
  })

  it('a failed database round-trip still fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    state.dbFails = true

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks).toEqual({ db: 'fail', config: 'ok' })
    expect(body.summary).toMatch(/База данных/)
  })

  it('an incomplete configuration still fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    state.missing = ['DATABASE_URL']

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks).toEqual({ db: 'ok', config: 'fail' })
    expect(body.summary).toMatch(/Конфигурация/)
  })

  it('the web role is the portal: its queue entry stays, and a queue that is off still fails the check', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'web')

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Очередь Workflow'])
    expect(body.checks.queue).toBe('fail')

    setWorkflowQueueStatus({ state: 'running', attempts: 1 })
    expect((await GET()).status).toBe(200)
  })

  it('an unknown PORTAL_ROLE is the portal too', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('PORTAL_ROLE', 'worker')
    setWorkflowQueueStatus({ state: 'running', attempts: 1 })

    const body = await (await GET()).json()

    expect(names(body)).toEqual(['База данных', 'Конфигурация сервера', 'Очередь Workflow'])
  })

  it('off Railway the role changes nothing: no queue entry either way', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '')
    vi.stubEnv('PORTAL_ROLE', 'agents')
    expect(names(await (await GET()).json())).toEqual(['База данных', 'Конфигурация сервера'])
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
    state.evidence = { last_cron: ago(4 * MIN), last_ping: null, since: ago(3 * 24 * 60 * MIN) }

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
    state.evidence = { last_cron: ago(40 * MIN), last_ping: null, since: ago(3 * 24 * 60 * MIN) }

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
    state.evidence = { last_cron: null, last_ping: null, since: ago(5 * MIN) }
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
    state.evidence = { last_cron: null, last_ping: ago(9 * MIN), since: ago(3 * 24 * 60 * MIN) }
    let body = await (await GET()).json()
    expect(entry(body, 'Фоновые задачи (Inngest)')).toMatchObject({ status: 'online' })
    expect(body.checks.inngest).toBe('ok')
    expect(body.checks).not.toHaveProperty('jobs') // CRON_RUNNER_ENABLED is not set here

    resetReadinessCache()
    state.evidence = { last_cron: null, last_ping: ago(45 * MIN), since: ago(3 * 24 * 60 * MIN) }
    const res = await GET()
    body = await res.json()
    expect(res.status).toBe(503)
    expect(body.checks.inngest).toBe('fail')
    expect(body.summary).toMatch(/Inngest/)
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
    state.evidence = { last_cron: ago(MIN), last_ping: null, since: ago(60 * MIN) }
    await Promise.all([GET(), GET(), GET()])
    const first = state.queries.length
    await GET()
    expect(state.queries.length).toBe(first)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 16_000)
    await GET()
    expect(state.queries.length).toBeGreaterThan(first)
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
