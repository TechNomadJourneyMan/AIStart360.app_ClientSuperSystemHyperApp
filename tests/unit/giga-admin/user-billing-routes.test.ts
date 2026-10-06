/**
 * GIGA plan editor routes (W8): /api/giga-admin/users/[id]/billing (+ /transactions).
 * Reading needs users.view, changing needs users.manage (real RBAC matrix),
 * staff at or above the actor's rank are protected (forbidTarget), and every
 * change goes through the billing service as an admin change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({ role: 'super_admin' as string, targetDenied: false }))
const billing = vi.hoisted(() => ({
  setPlan: vi.fn(),
  getEffectivePlan: vi.fn(),
  listPayments: vi.fn(),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: s.role as StaffRole })),
    forbidTarget: async () =>
      s.targetDenied ? NextResponse.json({ ok: false, error: 'Недостаточно прав для действий с этим сотрудником' }, { status: 403 }) : null,
  }
})
vi.mock('@/lib/payments/billing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/billing')>('@/lib/payments/billing')
  return { ...actual, setPlan: billing.setPlan, getEffectivePlan: billing.getEffectivePlan, listPayments: billing.listPayments }
})

import { GET, PATCH } from '@/app/api/giga-admin/users/[id]/billing/route'
import { GET as GET_TX } from '@/app/api/giga-admin/users/[id]/billing/transactions/route'
import { BillingError } from '@/lib/payments/billing'

const UID = '11111111-2222-3333-4444-555555555555'
const ctx = { params: { id: UID } }

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/giga-admin/users/${UID}/billing`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const plan = (over: Record<string, unknown> = {}) => ({
  tier: 'pro', status: 'active', periodEnd: null, source: 'admin', provider: null, note: null, accessTier: 'pro', orgId: UID, userId: UID, ...over,
})

describe('GIGA billing routes', () => {
  beforeEach(() => {
    s.role = 'super_admin'
    s.targetDenied = false
    billing.setPlan.mockReset().mockImplementation(async (input: { tier: string; periodEnd: Date | null }) => ({
      applied: true, orgId: UID, userId: UID, before: plan({ tier: 'free' }),
      after: plan({ tier: input.tier, periodEnd: input.periodEnd ? input.periodEnd.toISOString() : null }),
    }))
    billing.getEffectivePlan.mockReset().mockResolvedValue(plan())
    billing.listPayments.mockReset().mockResolvedValue([{ id: 't1', provider: 'kaspi', amount: 30000, currency: 'USD', status: 'succeeded' }])
  })

  describe('permissions', () => {
    it('reading needs users.view: analyst yes, content_manager no', async () => {
      s.role = 'analyst'
      expect((await GET(req('GET'), ctx)).status).toBe(200)
      expect((await GET_TX(req('GET'), ctx)).status).toBe(200)
      s.role = 'content_manager'
      expect((await GET(req('GET'), ctx)).status).toBe(403)
      expect((await GET_TX(req('GET'), ctx)).status).toBe(403)
    })

    it('changing needs users.manage: analyst, support and super_expert are refused', async () => {
      for (const role of ['analyst', 'support', 'super_expert', 'content_manager']) {
        s.role = role
        expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), ctx)).status).toBe(403)
      }
      expect(billing.setPlan).not.toHaveBeenCalled()
    })

    it('crm_manager (users.manage) may change the plan', async () => {
      s.role = 'crm_manager'
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), ctx)).status).toBe(200)
    })

    it('staff at or above the actor are protected (forbidTarget)', async () => {
      s.targetDenied = true
      const res = await PATCH(req('PATCH', { action: 'set', tier: 'enterprise' }), ctx)
      expect(res.status).toBe(403)
      expect(billing.setPlan).not.toHaveBeenCalled()
    })
  })

  describe('PATCH set', () => {
    it('assigns Enterprise for N months as an admin change with the actor and note', async () => {
      const before = Date.now()
      const res = await PATCH(req('PATCH', { action: 'set', tier: 'enterprise', months: 3, note: '  договор №7 ' }), ctx)
      expect(res.status).toBe(200)
      const input = billing.setPlan.mock.calls[0][0]
      expect(input).toMatchObject({ userId: UID, tier: 'enterprise', source: 'admin', note: 'договор №7', actor: { id: 'staff-1' } })
      const months = (input.periodEnd.getTime() - before) / 864e5
      expect(months).toBeGreaterThan(88)
      expect(months).toBeLessThan(93)
      expect((await res.json()).plan.tier).toBe('enterprise')
    })

    it('a bare date means the end of that day; no end = open-ended Pro', async () => {
      await PATCH(req('PATCH', { action: 'set', tier: 'pro', periodEnd: '2099-12-31' }), ctx)
      expect(billing.setPlan.mock.calls[0][0].periodEnd.toISOString()).toBe('2099-12-31T23:59:59.000Z')
      await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), ctx)
      expect(billing.setPlan.mock.calls[1][0].periodEnd).toBeNull()
    })

    it('validates: unknown tier, trial without an end, a past date, bad months, bad id', async () => {
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'gold' }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pilot' }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro', periodEnd: '2001-01-01' }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro', months: 0 }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro', months: 99 }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'nope' }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), { params: { id: 'nope' } })).status).toBe(400)
      expect(billing.setPlan).not.toHaveBeenCalled()
    })

    it('free ignores dates', async () => {
      await PATCH(req('PATCH', { action: 'set', tier: 'free', periodEnd: '2099-01-01' }), ctx)
      expect(billing.setPlan.mock.calls[0][0]).toMatchObject({ tier: 'free', periodEnd: null })
    })
  })

  describe('PATCH extend (free of charge)', () => {
    it('extends from the current end date, keeping the tier', async () => {
      billing.getEffectivePlan.mockResolvedValue(plan({ tier: 'enterprise', periodEnd: '2099-01-15T00:00:00.000Z' }))
      await PATCH(req('PATCH', { action: 'extend', months: 2 }), ctx)
      expect(billing.setPlan.mock.calls[0][0]).toMatchObject({ tier: 'enterprise', source: 'admin', meta: { months_added: 2, comp: true } })
      expect(billing.setPlan.mock.calls[0][0].periodEnd.toISOString()).toBe('2099-03-15T00:00:00.000Z')
    })

    it('extends an expired plan from today', async () => {
      billing.getEffectivePlan.mockResolvedValue(plan({ status: 'expired', periodEnd: '2020-01-01T00:00:00.000Z' }))
      const before = Date.now()
      await PATCH(req('PATCH', { action: 'extend', months: 1 }), ctx)
      expect(billing.setPlan.mock.calls[0][0].periodEnd.getTime()).toBeGreaterThan(before + 27 * 864e5)
    })

    it('refuses to extend free or open-ended plans', async () => {
      billing.getEffectivePlan.mockResolvedValue(plan({ tier: 'free', status: 'free', accessTier: 'free' }))
      expect((await PATCH(req('PATCH', { action: 'extend', months: 1 }), ctx)).status).toBe(422)
      billing.getEffectivePlan.mockResolvedValue(plan({ periodEnd: null }))
      expect((await PATCH(req('PATCH', { action: 'extend', months: 1 }), ctx)).status).toBe(422)
      expect((await PATCH(req('PATCH', { action: 'extend' }), ctx)).status).toBe(422)
      expect(billing.setPlan).not.toHaveBeenCalled()
    })
  })

  describe('honest errors', () => {
    it('503 when the journal is down or migration 106 is missing; 404 for an unknown user', async () => {
      billing.setPlan.mockRejectedValueOnce(new BillingError('audit_unavailable'))
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), ctx)).status).toBe(503)
      billing.setPlan.mockRejectedValueOnce(new BillingError('migration_106_required'))
      const res = await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), ctx)
      expect(res.status).toBe(503)
      expect((await res.json()).error).toBe('migration_106_required')
      billing.setPlan.mockRejectedValueOnce(new BillingError('not_found'))
      expect((await PATCH(req('PATCH', { action: 'set', tier: 'pro' }), ctx)).status).toBe(404)
    })
  })
})
