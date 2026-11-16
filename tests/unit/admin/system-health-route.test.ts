/**
 * GET /api/giga-admin/system/health (#42): a failed CRM read is "no data"
 * with the error, never 0 connections / 0 plaintext tokens; a failed agent
 * snapshot is reported as a failure, not as "migrations not applied".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  crm: { data: [] as unknown[] | null, error: null as { message: string } | null },
  snapshot: (async () => []) as () => Promise<unknown>,
  ops: (async () => ({ journal: 'ok', jobs: [], alertRoutes: { linkedStaff: 1, envChats: 0, direct: false, nowhere: false } })) as () => Promise<unknown>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: 'super_admin' })) }
})
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: async () => (table === 'crm_provider_connections' ? s.crm : { count: 1, error: null }),
    }),
    storage: { listBuckets: async () => ({ data: [{ id: 'cms-media' }, { id: 'documents' }] }) },
  }),
}))
vi.mock('@/lib/agents/definitions/monitoring', () => ({ platformHealthSnapshot: () => s.snapshot() }))
vi.mock('@/lib/ops/job-watchdog', () => ({ opsOverview: () => s.ops() }))

import { GET } from '@/app/api/giga-admin/system/health/route'

const call = async () => (await GET(new NextRequest('http://localhost/api/giga-admin/system/health'))).json()

beforeEach(() => {
  s.crm = { data: [], error: null }
  s.snapshot = async () => []
  s.ops = async () => ({ journal: 'ok', jobs: [], alertRoutes: { linkedStaff: 1, envChats: 0, direct: false, nowhere: false } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('system health — CRM block', () => {
  it('a query error gives crm=null and the error, not zeros', async () => {
    s.crm = { data: null, error: { message: 'permission denied for table crm_provider_connections' } }
    const body = await call()
    expect(body.integrations.crm).toBeNull()
    expect(body.integrations.crmError).toContain('permission denied')
  })

  it('real rows are counted, including plaintext tokens', async () => {
    s.crm = {
      data: [
        { is_active: true, last_sync_status: 'error', last_sync_at: '2026-10-01T00:00:00Z', access_token: 'plain' },
        { is_active: true, last_sync_status: 'ok', last_sync_at: '2026-10-05T00:00:00Z', access_token: 'v1:abc' },
      ],
      error: null,
    }
    const body = await call()
    expect(body.integrations).toEqual({ crm: { active: 2, errors: 1, plaintextTokens: 1, lastSyncAt: '2026-10-05T00:00:00Z' }, crmError: null })
  })
})

describe('system health — agent checks', () => {
  it('a database outage is a failure with its message, not "migrations not applied"', async () => {
    s.snapshot = async () => { throw new Error("Can't reach database server at db:5432") }
    const body = await call()
    expect(body.agents).toBeNull()
    expect(body.agentsError).toEqual({ kind: 'failed', message: "Can't reach database server at db:5432" })
  })

  it('a missing relation is reported as migrations not applied', async () => {
    s.snapshot = async () => { throw new Error('relation "public.agent_tasks" does not exist') }
    expect((await call()).agentsError).toMatchObject({ kind: 'not_migrated' })
  })
})

// R4-A1: the scheduled jobs from the journal of job outcomes and where alarms can go.
describe('system health — scheduled jobs and alarm routes', () => {
  it('the overview is passed through: jobs with their health, «nowhere to alert»', async () => {
    const overview = {
      journal: 'ok',
      jobs: [{ job: '/api/cron/expert-sla', label: 'SLA экспертов', kind: 'cron', schedule: '*/5 * * * *', lastAt: '2026-11-16T10:00:00.000Z', lastStatus: 'ok', health: 'stale', allowedMinutes: 20 }],
      alertRoutes: { linkedStaff: 0, envChats: 0, direct: false, nowhere: true },
    }
    s.ops = async () => overview
    const body = await call()
    expect(body.ops).toEqual(overview)
    expect(body.opsError).toBeNull()
  })

  it('a failed read is a failure with its message, never an empty «all fine»', async () => {
    s.ops = async () => { throw new Error("Can't reach database server at db:5432") }
    const body = await call()
    expect(body.ops).toBeNull()
    expect(body.opsError).toEqual({ kind: 'failed', message: "Can't reach database server at db:5432" })
  })
})

describe('system health — what is deployed (Railway)', () => {
  it('Railway deployment and environment are shown; Vercel variables are only a fallback', async () => {
    vi.stubEnv('RAILWAY_DEPLOYMENT_ID', '8d5f0079-e957-45c3-afbd-f7c3bb5c67a8')
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', '')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
    vi.stubEnv('VERCEL_ENV', '')
    try {
      const body = await call()
      expect(body.runtime.deployment).toBe('8d5f0079')
      expect(body.runtime.env).toBe('production')
      expect(body.runtime.commit).toBeNull()
      vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', '0aa6f3ab1234567890')
      expect((await call()).runtime.commit).toBe('0aa6f3a')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
