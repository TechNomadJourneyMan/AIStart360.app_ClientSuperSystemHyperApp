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

import { GET } from '@/app/api/giga-admin/system/health/route'

const call = async () => (await GET(new NextRequest('http://localhost/api/giga-admin/system/health'))).json()

beforeEach(() => {
  s.crm = { data: [], error: null }
  s.snapshot = async () => []
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
