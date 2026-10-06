/**
 * POST /api/checkout, trial plan (W8): the trial now opens access too —
 * subscriptions pilot/trialing AND profiles.tier = 'pro' in one billing call —
 * once per person, and never over a live plan (no downgrade by clicking «Пилот»).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const USER = '11111111-2222-3333-4444-555555555555'
const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: '11111111-2222-3333-4444-555555555555', email: 'c@example.com' } } }) },
    from: (table: string) => (state.client as { from: (t: string) => unknown }).from(table),
  }),
}))

import { POST } from '@/app/api/checkout/route'

let db: FakeDb
const iso = (d: Date) => d.toISOString().replace('Z', '')
const trial = () => POST(new NextRequest('http://localhost/api/checkout', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planKey: 'pilot' }),
}))

describe('checkout trial', () => {
  beforeEach(() => {
    db = fakeDb({ profiles: [{ id: USER, tier: 'free' }], companies: [], subscriptions: [] })
    state.client = fakeClient(db, sqlModel)
  })

  it('starts a 30-day trial in subscriptions AND opens Pro access in profiles.tier', async () => {
    const res = await trial()
    expect(res.status).toBe(200)
    expect((await res.json()).checkoutUrl).toBe('/dashboard')
    expect(db.rpcCalls[0].args).toMatchObject({ p_org_id: USER, p_user_id: USER, p_tier: 'pilot', p_source: 'trial' })
    const days = (new Date(String(db.rpcCalls[0].args.p_period_end)).getTime() - Date.now()) / 864e5
    expect(Math.round(days)).toBe(30)
    expect(db.tables.subscriptions[0]).toMatchObject({ tier: 'pilot', status: 'trialing', source: 'trial' })
    expect(db.tables.profiles[0].tier).toBe('pro')
  })

  it('never replaces a live plan', async () => {
    db.tables.subscriptions.push({ orgId: USER, tier: 'enterprise', status: 'active', currentPeriodEnd: null, updatedAt: iso(new Date()) })
    db.tables.profiles[0].tier = 'pro'
    const res = await trial()
    expect((await res.json()).checkoutUrl).toBe('/dashboard')
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.subscriptions[0].tier).toBe('enterprise')
  })

  it('a used trial cannot be restarted', async () => {
    db.tables.subscriptions.push({ orgId: USER, tier: 'pilot', status: 'canceled', trialEndsAt: iso(new Date(Date.now() - 864e5)), updatedAt: iso(new Date()) })
    const res = await trial()
    expect(res.status).toBe(409)
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.profiles[0].tier).toBe('free')
  })

  it('answers 503 instead of a dashboard link that grants nothing', async () => {
    state.client = fakeClient(db, () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.billing_set_plan' } }))
    expect((await trial()).status).toBe(503)
  })
})
