/**
 * GET /api/health reports only what it measures (shared with /intelligence via
 * lib/health/platform.ts): database round-trip and configuration completeness.
 * No made-up uptime, no names of missing variables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dbFails: false, missing: [] as string[] }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async () => {
      if (state.dbFails) throw new Error('connection refused')
      return [{ '?column?': 1 }]
    },
  },
}))
vi.mock('@/lib/env', () => ({ getMissingServerEnv: () => state.missing }))

import { GET } from '@/app/api/health/route'
import { setWorkflowQueueStatus } from '@/lib/runtime/workflow-queue-status'

const QUEUE_STATUS_KEY = Symbol.for('aistart360.workflow.queue.status')

beforeEach(() => { state.dbFails = false; state.missing = [] })
afterEach(() => {
  vi.unstubAllEnvs()
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
    expect((await (await GET()).json()).summary).toMatch(/Конфигурация/)
  })
})
