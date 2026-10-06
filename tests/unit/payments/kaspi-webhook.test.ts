/**
 * POST /api/webhooks/kaspi still upgrades the client — now through the billing
 * service (subscriptions + profiles.tier in one billing_set_plan call), and the
 * transaction is marked succeeded inside that same call (p_payment_tx), so a
 * failed upgrade is retried by Kaspi and a duplicate callback adds nothing.
 */
import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const state = vi.hoisted(() => ({ client: null as unknown }))
const prismaMock = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  update: vi.fn(),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    paymentTransaction: {
      findFirst: async () => prismaMock.tx,
      update: (...a: unknown[]) => prismaMock.update(...a),
    },
  },
}))

import { POST } from '@/app/api/webhooks/kaspi/route'

const SECRET = 'test-kaspi-webhook-secret'
const USER = '11111111-2222-3333-4444-555555555555'
const COMPANY = 'company-1'
let db: FakeDb

function signed(body: Record<string, unknown>): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/kaspi', {
    method: 'POST',
    headers: { 'x-kaspi-signature': createHmac('sha256', SECRET).update(raw).digest('hex') },
    body: raw,
  })
}

describe('kaspi webhook → billing service', () => {
  const saved = process.env.KASPI_WEBHOOK_SECRET
  beforeEach(() => {
    process.env.KASPI_WEBHOOK_SECRET = SECRET
    db = fakeDb({
      profiles: [{ id: USER, tier: 'free' }],
      companies: [{ id: COMPANY, user_id: USER }],
      subscriptions: [],
    })
    state.client = fakeClient(db, sqlModel)
    prismaMock.tx = { id: 'tx-1', orgId: COMPANY, provider: 'kaspi', status: 'pending', planKey: 'pro_monthly', amount: 30000, currency: 'USD', metadata: { amountKzt: 157650 } }
    prismaMock.update.mockReset().mockResolvedValue({})
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.KASPI_WEBHOOK_SECRET
    else process.env.KASPI_WEBHOOK_SECRET = saved
  })

  it('a successful payment upgrades subscription and profiles.tier, then finalises the transaction', async () => {
    const res = await POST(signed({ paymentId: 'pay_1', status: 'success', amount: 157650 }))
    expect(res.status).toBe(200)

    expect(db.rpcCalls.map((c) => c.name)).toEqual(['billing_set_plan'])
    expect(db.rpcCalls[0].args).toMatchObject({ p_org_id: COMPANY, p_user_id: USER, p_tier: 'pro', p_source: 'kaspi', p_provider: 'kaspi', p_actor: 'kaspi:webhook' })
    // The month is added in SQL under the row locks (p_extend_months).
    expect(db.rpcCalls[0].args.p_extend_months).toBe(1)
    expect(db.rpcCalls[0].args.p_period_end).toBeNull()
    expect(db.tables.subscriptions[0]).toMatchObject({ tier: 'pro', status: 'active', source: 'kaspi' })
    expect(db.tables.profiles[0].tier).toBe('pro')
    expect(db.rpcCalls[0].args.p_payment_tx).toBe('tx-1')
    expect(prismaMock.update).not.toHaveBeenCalled()
  })

  it('a one-time purchase gives open-ended Pro', async () => {
    prismaMock.tx = { ...prismaMock.tx!, planKey: 'pro_onetime', metadata: {} }
    await POST(signed({ paymentId: 'pay_1', status: 'paid' }))
    expect(db.rpcCalls[0].args.p_period_end).toBeNull()
    expect(db.rpcCalls[0].args.p_extend_months).toBeUndefined()
    expect(db.tables.profiles[0].tier).toBe('pro')
  })

  it('when the plan cannot be written the transaction stays pending and Kaspi gets 500 (retry)', async () => {
    state.client = fakeClient(db, () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.billing_set_plan' } }))
    const res = await POST(signed({ paymentId: 'pay_1', status: 'success' }))
    expect(res.status).toBe(500)
    expect(prismaMock.update).not.toHaveBeenCalled()
  })

  it('already finalised payments are not applied twice', async () => {
    prismaMock.tx = { ...prismaMock.tx!, status: 'succeeded' }
    const res = await POST(signed({ paymentId: 'pay_1', status: 'success' }))
    expect((await res.json()).note).toBe('already_finalized')
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('rejects a bad signature without touching the plan', async () => {
    const res = await POST(new NextRequest('http://localhost/api/webhooks/kaspi', {
      method: 'POST', headers: { 'x-kaspi-signature': 'bad' }, body: JSON.stringify({ paymentId: 'pay_1', status: 'success' }),
    }))
    expect(res.status).toBe(401)
    expect(db.rpcCalls).toHaveLength(0)
  })
})
