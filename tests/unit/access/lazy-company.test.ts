/**
 * R2-C (product review L-11): the company inheritance costs a Free request no
 * extra SEQUENTIAL query and is not asked at all where it cannot change the
 * answer. The decision (lib/access/decision.ts) reads the own rights first;
 * only on the refusal path it asks the company (RPC company_inherited_rights)
 * — in parallel with the staff check:
 *   • gates off → no RPC, no staff check;
 *   • Pro (all open) → no RPC;
 *   • Free, gates on → RPC and staff check start together; the inherited right
 *     opens the section ('entitled').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  gates: true,
  tier: 'free' as string,
  flags: {} as Record<string, boolean>,
  companyReply: { point_a: true, point_b: true, market: true, gri_full: true, gri_full_unlimited: true } as Record<string, boolean>,
  rpcCalls: 0,
  staffCalls: 0,
  events: [] as string[],
  staff: false,
}))

vi.mock('@/lib/settings/system-settings', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => 1 }))
vi.mock('@/lib/api-identity', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSessionStaff: async () => {
    s.staffCalls++
    s.events.push('staff:start')
    await new Promise((r) => setTimeout(r, 5))
    s.events.push('staff:end')
    return s.staff ? { id: 'u', role: 'admin' } : null
  },
}))

const sb = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier: s.tier, feature_flags: s.flags }, error: null }) }) }) }),
  rpc: async () => {
    s.rpcCalls++
    s.events.push('rpc:start')
    await new Promise((r) => setTimeout(r, 5))
    s.events.push('rpc:end')
    return { data: s.companyReply, error: null }
  },
}

const { resolveAccess, resolveFeature } = await import('@/lib/access/decision')

beforeEach(() => {
  s.gates = true
  s.tier = 'free'
  s.flags = {}
  s.rpcCalls = 0
  s.staffCalls = 0
  s.events = []
  s.staff = false
  s.companyReply = { point_a: true, point_b: true, market: true, gri_full: true, gri_full_unlimited: true }
})

describe('the company is asked only on the refusal path', () => {
  it('gates off: no RPC, no staff check', async () => {
    s.gates = false
    expect((await resolveFeature(sb as never, 'u', 'point_a', { exemptStaff: true })).allowed).toBe(true)
    expect((await resolveAccess(sb as never, 'u')).sections.market).toBe(true)
    expect(s.rpcCalls).toBe(0)
    expect(s.staffCalls).toBe(0)
  })

  it('Pro: no RPC', async () => {
    s.tier = 'pro'
    expect((await resolveFeature(sb as never, 'u', 'point_a', { exemptStaff: true })).reason).toBe('entitled')
    expect((await resolveAccess(sb as never, 'u')).sections).toEqual({ point_a: true, point_b: true, market: true, gri_full: true })
    expect(s.rpcCalls).toBe(0)
    expect(s.staffCalls).toBe(0)
  })

  it('Free member of a Pro company: the RPC and the staff check run together; the inherited right opens the section', async () => {
    const d = await resolveFeature(sb as never, 'u', 'market', { exemptStaff: true })
    expect(d).toMatchObject({ allowed: true, reason: 'entitled' })
    expect(d.ent.viaCompany).toContain('market')
    expect(s.events.slice(0, 2).sort()).toEqual(['rpc:start', 'staff:start']) // both started before either ended
  })

  it('Free without a company: closed after one parallel step; resolveAccess the same', async () => {
    s.companyReply = { point_a: false, point_b: false, market: false, gri_full: false, gri_full_unlimited: false }
    expect((await resolveFeature(sb as never, 'u', 'point_a', { exemptStaff: true })).allowed).toBe(false)
    const a = await resolveAccess(sb as never, 'u')
    expect(a.sections).toEqual({ point_a: false, point_b: false, market: false, gri_full: false })
    expect(s.rpcCalls).toBe(2)
    expect(s.staffCalls).toBe(2)
  })

  it('an explicit own false is not reopened by the company; staff still pass', async () => {
    s.flags = { point_a: false }
    expect((await resolveFeature(sb as never, 'u', 'point_a', { exemptStaff: true })).allowed).toBe(false)
    s.staff = true
    expect((await resolveFeature(sb as never, 'u', 'point_a', { exemptStaff: true })).reason).toBe('staff')
  })
})
