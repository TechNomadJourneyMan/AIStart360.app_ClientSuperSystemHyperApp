/**
 * Point B is a Pro feature (plan Phase 1 Task 8): the entitlement, the server gate on the
 * client API (diagnostics/point-b, ai-generate), /api/v1/access/me, the paywall and the
 * /point-b → /client/point-b redirect for clients. The master switch `access_gates` stays
 * the single authority: while it is off nothing is restricted; staff are never gated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { can, entitlementsFor, normalizeOverrides } from '@/lib/access/entitlements'

const s = vi.hoisted(() => ({
  gates: false,
  tier: 'free' as 'free' | 'pro',
  flags: {} as Record<string, boolean>,
  role: 'client' as string,
  user: { id: 'u-1' } as { id: string } | null,
  inputsCalls: 0,
}))

vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/access/server', async () => {
  const ent = await import('@/lib/access/entitlements')
  return { readEntitlements: async () => ent.entitlementsFor(s.tier, s.flags) }
})
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-identity')>('@/lib/api-identity')
  return { ...real, getSessionUser: async () => s.user, getSessionRole: async () => s.role }
})
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/point-b/inputs', () => ({ loadPointBInputs: async () => { s.inputsCalls += 1; return { diagnostic: null } } }))
vi.mock('@/lib/point-b/compute', () => ({ computePointB: () => null }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => null }))
vi.mock('@/lib/internal-auth', () => ({ hasValidInternalToken: () => false }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/goals/current', () => ({ loadGoalsWithEvaluation: async () => [] }))

const { gateFeature } = await import('@/lib/access/gate')
const meRoute = await import('@/app/api/v1/access/me/route')
const pointBRoute = await import('@/app/api/v1/diagnostics/point-b/route')
const aiRoute = await import('@/app/api/v1/diagnostics/point-b/ai-generate/route')
const access = await import('@/components/point-b/pointBAccess')
const { default: PointBPaywall } = await import('@/components/point-b/PointBPaywall')

const sb = {} as never
const req = () => new NextRequest('http://t/api/v1/diagnostics/point-b')
const post = () => new NextRequest('http://t/api/v1/diagnostics/point-b/ai-generate', { method: 'POST', body: '{}' })

beforeEach(() => {
  s.gates = false
  s.tier = 'free'
  s.flags = {}
  s.role = 'client'
  s.user = { id: 'u-1' }
  s.inputsCalls = 0
})

describe('entitlement', () => {
  it('free has no point_b, pro has', () => {
    expect(entitlementsFor('free').point_b).toBe(false)
    expect(entitlementsFor('pro').point_b).toBe(true)
    expect(can(entitlementsFor('pro'), 'point_b')).toBe(true)
    expect(can(entitlementsFor('free'), 'point_b')).toBe(false)
  })

  it('override point_b true opens it for a free user, false closes it for pro', () => {
    expect(entitlementsFor('free', { point_b: true }).point_b).toBe(true)
    expect(entitlementsFor('pro', { point_b: false }).point_b).toBe(false)
    expect(normalizeOverrides({ point_b: true, other: true, point_a: 1 })).toEqual({ point_b: true })
  })
})

describe('gateFeature(point_b)', () => {
  it('returns 402 upgrade_required for free when gates are enabled', async () => {
    s.gates = true
    const res = await gateFeature(sb, 'u-1', 'point_b')
    expect(res?.status).toBe(402)
    const body = await res!.json()
    expect(body).toMatchObject({ ok: false, error: 'upgrade_required', feature: 'point_b' })
    expect(body.message).toBe('Точка Б доступна на тарифе Pro вместе с полным GRI и Точкой А.')
  })

  it('passes when gates are disabled (the default)', async () => {
    s.gates = false
    expect(await gateFeature(sb, 'u-1', 'point_b')).toBeNull()
  })

  it('passes for pro and for a per-user override', async () => {
    s.gates = true
    s.tier = 'pro'
    expect(await gateFeature(sb, 'u-1', 'point_b')).toBeNull()
    s.tier = 'free'
    s.flags = { point_b: true }
    expect(await gateFeature(sb, 'u-1', 'point_b')).toBeNull()
  })

  it('staff are not gated when exempted, a client is', async () => {
    s.gates = true
    s.role = 'expert'
    expect(await gateFeature(sb, 'u-1', 'point_b', { exemptStaff: true })).toBeNull()
    expect((await gateFeature(sb, 'u-1', 'point_b'))?.status).toBe(402)
    s.role = 'client'
    expect((await gateFeature(sb, 'u-1', 'point_b', { exemptStaff: true }))?.status).toBe(402)
  })
})

describe('access/me', () => {
  it('exposes point_b', async () => {
    s.tier = 'pro'
    const body = await (await meRoute.GET()).json()
    expect(body.entitlements.point_b).toBe(true)
    s.tier = 'free'
    expect((await (await meRoute.GET()).json()).entitlements.point_b).toBe(false)
  })
})

describe('diagnostics/point-b and ai-generate', () => {
  it('diagnostics/point-b: 402 for free with gates on and no data read; 200 for pro', async () => {
    s.gates = true
    const denied = await pointBRoute.GET(req())
    expect(denied.status).toBe(402)
    expect(s.inputsCalls).toBe(0)

    s.tier = 'pro'
    const ok = await pointBRoute.GET(req())
    expect(ok.status).toBe(200)
    expect(s.inputsCalls).toBe(1)
  })

  it('diagnostics/point-b: free is let through while the gates are off, staff always', async () => {
    expect((await pointBRoute.GET(req())).status).toBe(200)
    s.gates = true
    s.role = 'admin'
    expect((await pointBRoute.GET(req())).status).toBe(200)
  })

  it('diagnostics/point-b: 401 without a session stays 401', async () => {
    s.user = null
    s.gates = true
    expect((await pointBRoute.GET(req())).status).toBe(401)
  })

  it('ai-generate is gated the same way and reads no inputs when denied', async () => {
    s.gates = true
    const denied = await aiRoute.POST(post())
    expect(denied.status).toBe(402)
    expect(s.inputsCalls).toBe(0)

    s.tier = 'pro'
    const ok = await aiRoute.POST(post())
    expect(ok.status).toBe(404) // past the gate: the double has no diagnostic
    expect(s.inputsCalls).toBe(1)
  })
})

describe('page logic', () => {
  it('loading draws nothing of the client; gates off or pointB on is open; gates on without pointB is locked', () => {
    expect(access.resolvePointBAccess({ loading: true, gatesEnabled: true, pointB: false })).toBe('loading')
    expect(access.resolvePointBAccess({ loading: false, gatesEnabled: false, pointB: false })).toBe('open')
    expect(access.resolvePointBAccess({ loading: false, gatesEnabled: true, pointB: true })).toBe('open')
    expect(access.resolvePointBAccess({ loading: false, gatesEnabled: true, pointB: false })).toBe('locked')
  })

  it('a 402 from the API locks the page too', () => {
    expect(access.isUpgradeRequired(402, null)).toBe(true)
    expect(access.isUpgradeRequired(200, { error: 'upgrade_required' })).toBe(true)
    expect(access.isUpgradeRequired(500, { error: 'boom' })).toBe(false)
  })

  it('/point-b redirects clients (also legacy owner and unknown roles), not staff', () => {
    for (const r of ['client', 'owner', null, undefined]) expect(access.isClientForPointB(r)).toBe(true)
    for (const r of ['expert', 'admin', 'super_admin']) expect(access.isClientForPointB(r)).toBe(false)
  })

  it('the upgrade request goes to the existing endpoint and reports sent / error', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return { ok: true } }) as unknown as typeof fetch
    expect(await access.sendUpgradeRequest(ok)).toBe('sent')
    expect(calls[0]).toEqual({ url: '/api/v1/upgrade-request', body: { featureKey: '/point-b' } })
    expect(await access.sendUpgradeRequest((async () => ({ ok: false })) as unknown as typeof fetch)).toBe('error')
    expect(await access.sendUpgradeRequest((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe('error')
  })

  it('the paywall explains the tariff and offers «Узнать о Pro», with no client data', () => {
    const html = renderToStaticMarkup(React.createElement(PointBPaywall))
    expect(html).toContain('Точка Б доступна на тарифе Pro вместе с полным GRI и Точкой А.')
    expect(html).toContain('Узнать о Pro')
    expect(html).toContain('aria-labelledby="pb-paywall-title"')
  })
})
