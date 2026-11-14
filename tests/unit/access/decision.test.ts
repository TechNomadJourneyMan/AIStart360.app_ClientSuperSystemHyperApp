/**
 * R2-A: ONE decision «is the paid section open» (lib/access/decision.ts) — the
 * same for the API gate (402), the page gate and /api/v1/access/me.
 * Point A, Point B, Market and the full GRI are paid (founder, 2026-11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entitlementsFor } from '@/lib/access/entitlements'

const s = vi.hoisted(() => ({
  gates: true,
  tier: 'free' as 'free' | 'pro',
  flags: {} as Record<string, boolean>,
  role: 'client' as string | null,
  staffRow: null as { id: string; role: string } | null,
  roleThrows: false,
  staffReads: 0,
}))

vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/access/server', async () => {
  const ent = await import('@/lib/access/entitlements')
  return { readEntitlements: async () => ent.entitlementsFor(s.tier, s.flags) }
})
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-identity')>('@/lib/api-identity')
  return {
    ...real,
    getSessionStaff: async () => {
      s.staffReads += 1
      if (s.roleThrows) throw new Error('db down')
      return s.staffRow ?? (real.isStaffRole(s.role) ? { id: 'u-1', role: s.role as string } : null)
    },
  }
})

const { decideFeature, decideSections, resolveFeature, resolveAccess, isStaffSession } = await import('@/lib/access/decision')
const { gateFeature, gatePaidSection, upgradeRequiredResponse } = await import('@/lib/access/gate')

const sb = {} as never
const PAID = ['point_a', 'point_b', 'market', 'gri_full'] as const

beforeEach(() => {
  s.gates = true
  s.tier = 'free'
  s.flags = {}
  s.role = 'client'
  s.staffRow = null
  s.roleThrows = false
  s.staffReads = 0
})

describe('decideFeature (pure)', () => {
  it('gates off → every section open, whatever the tariff', () => {
    for (const f of PAID) expect(decideFeature({ gatesEnabled: false, ent: entitlementsFor('free') }, f)).toEqual({ allowed: true, reason: 'gates_off' })
  })

  it('gates on: Free is closed on all four paid sections; Pro is open', () => {
    for (const f of PAID) {
      expect(decideFeature({ gatesEnabled: true, ent: entitlementsFor('free') }, f)).toEqual({ allowed: false, reason: 'upgrade_required' })
      expect(decideFeature({ gatesEnabled: true, ent: entitlementsFor('pro') }, f)).toEqual({ allowed: true, reason: 'entitled' })
    }
  })

  it('a per-user override opens a section for Free and can close it for Pro', () => {
    expect(decideFeature({ gatesEnabled: true, ent: entitlementsFor('free', { market: true }) }, 'market').allowed).toBe(true)
    expect(decideFeature({ gatesEnabled: true, ent: entitlementsFor('pro', { point_a: false }) }, 'point_a').allowed).toBe(false)
  })

  it('staff of the session pass; the decision says why', () => {
    expect(decideFeature({ gatesEnabled: true, ent: entitlementsFor('free'), staff: true }, 'point_a')).toEqual({ allowed: true, reason: 'staff' })
  })

  it('decideSections gives all four answers at once', () => {
    expect(decideSections({ gatesEnabled: true, ent: entitlementsFor('free', { point_b: true }) })).toEqual({ point_a: false, point_b: true, market: false, gri_full: false })
    expect(decideSections({ gatesEnabled: false, ent: entitlementsFor('free') })).toEqual({ point_a: true, point_b: true, market: true, gri_full: true })
  })
})

describe('resolveFeature / gate (server)', () => {
  it('Free with gates on → 402 upgrade_required with the feature and a Russian message, for each paid section', async () => {
    for (const f of PAID) {
      const res = await gatePaidSection(sb, 'u-1', f)
      expect(res?.status).toBe(402)
      const body = await res!.json()
      expect(body).toMatchObject({ ok: false, error: 'upgrade_required', feature: f })
      expect(body.message).toMatch(/платн/)
    }
  })

  it('Pro passes without reading the staff role (no extra query on the normal path)', async () => {
    s.tier = 'pro'
    for (const f of PAID) expect(await gatePaidSection(sb, 'u-1', f)).toBeNull()
    expect(s.staffReads).toBe(0)
  })

  it('gates off (fail-safe default of the switch) → nothing is gated', async () => {
    s.gates = false
    for (const f of PAID) expect(await gatePaidSection(sb, 'u-1', f)).toBeNull()
  })

  it('staff pass: staff_roles or an active expert with the second factor (getSessionStaff, migration 140)', async () => {
    s.role = 'admin'
    expect(await gatePaidSection(sb, 'u-1', 'point_a')).toBeNull()
    s.role = 'client'
    s.staffRow = { id: 'u-1', role: 'crm_manager' } // a staff member whose profile role is 'client'
    expect(await gatePaidSection(sb, 'u-1', 'market')).toBeNull()
  })

  it('«от имени» the session is the client\'s: no staff → closed like for the client', async () => {
    s.role = 'client'
    s.staffRow = null
    expect((await gatePaidSection(sb, 'u-1', 'point_b'))?.status).toBe(402)
  })

  it('a failure reading the staff role fails CLOSED', async () => {
    s.roleThrows = true
    expect(await isStaffSession(sb, 'u-1')).toBe(false)
    expect((await gatePaidSection(sb, 'u-1', 'gri_full'))?.status).toBe(402)
  })

  it('gateFeature without exemptStaff does not exempt staff (AI chat / PDF keep their own rule)', async () => {
    s.role = 'admin'
    expect((await gateFeature(sb, 'u-1', 'ai_chat'))?.status).toBe(402)
  })

  it('resolveFeature returns the rights and the switch with the decision', async () => {
    const d = await resolveFeature(sb, 'u-1', 'point_a', { exemptStaff: true })
    expect(d).toMatchObject({ allowed: false, reason: 'upgrade_required', gatesEnabled: true })
    expect(d.ent.tier).toBe('free')
  })

  it('resolveAccess: the snapshot for UI — staff read only when something is closed', async () => {
    s.tier = 'pro'
    expect(await resolveAccess(sb, 'u-1')).toMatchObject({ staff: false, sections: { point_a: true, point_b: true, market: true, gri_full: true } })
    expect(s.staffReads).toBe(0)
    s.tier = 'free'
    expect((await resolveAccess(sb, 'u-1')).sections).toEqual({ point_a: false, point_b: false, market: false, gri_full: false })
    s.role = 'expert'
    expect(await resolveAccess(sb, 'u-1')).toMatchObject({ staff: true, sections: { point_a: true, point_b: true, market: true, gri_full: true } })
  })

  it('upgradeRequiredResponse has one shape for every paid API', async () => {
    const body = await upgradeRequiredResponse('market').json()
    expect(Object.keys(body).sort()).toEqual(['error', 'feature', 'message', 'ok'])
  })
})
