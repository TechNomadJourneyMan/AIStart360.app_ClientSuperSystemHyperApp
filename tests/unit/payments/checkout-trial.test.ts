/**
 * POST /api/checkout, trial plan (W8): the trial now opens access too —
 * subscriptions pilot/trialing AND profiles.tier = 'pro' in one billing call —
 * once per person, and never over a live plan (no downgrade by clicking «Пилот»).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const USER = '11111111-2222-3333-4444-555555555555'
const state = vi.hoisted(() => ({
  client: null as unknown,
  // R2-A (ревью H-1): the platform setting pilot_self_service (default OFF).
  pilotSelfService: true as boolean | 'throw',
  impersonating: false,
  requests: [] as Array<{ userId: string; featureKey: string }>,
  requestFails: false,
  isClient: true,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))
vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => {
    if (key !== 'pilot_self_service') throw new Error('unexpected setting ' + key)
    if (state.pilotSelfService === 'throw') throw new Error('db down')
    return state.pilotSelfService
  },
}))
vi.mock('@/lib/access/upgrade-requests', () => ({
  isClientAccount: async () => state.isClient,
  submitAccessRequest: async (_sb: unknown, args: { userId: string; featureKey: string }) => {
    if (state.requestFails) throw new Error('insert failed')
    const duplicate = state.requests.some((r) => r.userId === args.userId)
    if (!duplicate) state.requests.push(args)
    return { id: 'req-1', created: !duplicate, features: ['pilot'] }
  },
}))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (state.impersonating ? { uid: 'x' } : null) }))
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

describe('checkout trial (pilot_self_service ON — the previous behaviour)', () => {
  beforeEach(() => {
    db = fakeDb({ profiles: [{ id: USER, tier: 'free' }], companies: [], subscriptions: [] })
    state.client = fakeClient(db, sqlModel)
    state.pilotSelfService = true
    state.impersonating = false
    state.requests = []
    state.requestFails = false
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

describe('R2-A H-1: pilot with pilot_self_service OFF (the default) — no self-granted access', () => {
  beforeEach(() => {
    db = fakeDb({ profiles: [{ id: USER, tier: 'free' }], companies: [], subscriptions: [] })
    state.client = fakeClient(db, sqlModel)
    state.pilotSelfService = false
    state.impersonating = false
    state.requests = []
    state.requestFails = false
    state.isClient = true
  })

  it('R4 (verify WB-6): a staff member or an expert cannot file the pilot request — 403, nothing stored', async () => {
    state.isClient = false
    const res = await trial()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_client')
    expect(state.requests).toEqual([])
  })

  it('a Free client does NOT get Pro: no billing call, tier stays free; an access request is created and the answer is honest', async () => {
    const res = await trial()
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, requested: true, duplicate: false, checkoutUrl: null })
    expect(body.message).toContain('менеджер')
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.profiles[0].tier).toBe('free')
    expect(db.tables.subscriptions).toHaveLength(0)
    expect(state.requests).toEqual([{ userId: USER, featureKey: 'pilot' }])
  })

  it('a repeat does not duplicate the request', async () => {
    await trial()
    const body = await (await trial()).json()
    expect(body.duplicate).toBe(true)
    expect(state.requests).toHaveLength(1)
  })

  it('an unreadable setting counts as OFF (fail closed)', async () => {
    state.pilotSelfService = 'throw'
    expect((await trial()).status).toBe(202)
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('«от имени» staff do not leave the request for the client; a storage failure is 503, not «sent»', async () => {
    state.impersonating = true
    expect((await trial()).status).toBe(403)
    state.impersonating = false
    state.requestFails = true
    expect((await trial()).status).toBe(503)
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('paid plans are not affected by the setting (the acquiring stub path)', async () => {
    const res = await POST(new NextRequest('http://localhost/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planKey: 'pro_monthly' }),
    }))
    expect(res.status).not.toBe(202)
  })
})
