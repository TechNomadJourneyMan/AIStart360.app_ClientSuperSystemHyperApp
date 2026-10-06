/**
 * GET /api/cron/billing-expiry (W8): CRON_SECRET bearer only; downgrades ended
 * trials / periods to free through the billing service, journalled as the
 * system; a second run changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))

import { GET } from '@/app/api/cron/billing-expiry/route'

const USER = '11111111-2222-3333-4444-555555555555'
const SECRET = 'cron-secret-for-tests'
let db: FakeDb
const iso = (d: Date) => d.toISOString().replace('Z', '')
const call = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/billing-expiry', { headers: auth ? { authorization: auth } : {} }))

describe('billing expiry cron', () => {
  const saved = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    db = fakeDb({
      profiles: [{ id: USER, tier: 'pro' }],
      companies: [],
      subscriptions: [{ orgId: USER, tier: 'pro', status: 'active', currentPeriodEnd: iso(new Date(Date.now() - 3600e3)), source: 'admin', updatedAt: iso(new Date()) }],
    })
    state.client = fakeClient(db, sqlModel)
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })

  it('refuses calls without the secret, and fails closed when it is not configured', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503)
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('downgrades an ended period once; the next run is a no-op', async () => {
    const first = await (await call(`Bearer ${SECRET}`)).json()
    expect(first).toEqual({ ok: true, due: 1, downgraded: 1, skipped: 0, failed: 0 })
    expect(db.tables.subscriptions[0]).toMatchObject({ status: 'canceled', source: 'system' })
    expect(db.tables.profiles[0].tier).toBe('free')
    expect(db.tables.admin_audit_log).toEqual([expect.objectContaining({ actor_id: 'system:billing-expiry', actor_kind: 'system', action: 'billing.plan_expired', target_user_id: USER })])

    const second = await (await call(`Bearer ${SECRET}`)).json()
    expect(second).toEqual({ ok: true, due: 0, downgraded: 0, skipped: 0, failed: 0 })
    expect(db.tables.admin_audit_log).toHaveLength(1)
  })

  it('without a journal nothing is downgraded (retried next run)', async () => {
    db.auditFails = true
    const body = await (await call(`Bearer ${SECRET}`)).json()
    expect(body).toMatchObject({ due: 1, downgraded: 0, failed: 1 })
    expect(db.tables.profiles[0].tier).toBe('pro')
  })

  it('503 when migration 106 is missing', async () => {
    state.client = fakeClient(db, () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.billing_due_expirations' } }))
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503)
  })
})
