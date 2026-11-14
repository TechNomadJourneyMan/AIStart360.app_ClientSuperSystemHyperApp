/**
 * R2-C (Q3): members of a company inherit the tariff of the company. The
 * portal's rule (lib/access/entitlements.ts withCompanyRights, read by
 * lib/access/server.ts readEntitlements from the SQL function
 * company_inherited_rights of migration 148) — the same order as
 * has_paid_section(): own explicit override → own tariff → the company.
 * The SQL side and «one rule» on the real schema: tests/integration/db/
 * paid-sections-rls.test.ts and paid-access-one-rule.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  can,
  canRunFullGri,
  entitlementsFor,
  needsCompanyRights,
  parseCompanyRights,
  withCompanyRights,
} from '@/lib/access/entitlements'
import { readEntitlements } from '@/lib/access/server'
import { decideFeature } from '@/lib/access/decision'

const PRO_COMPANY = { point_a: true, point_b: true, market: true, gri_full: true, pdf_export: true, ai_chat: true, benchmarks: true, gri_full_unlimited: true }
const NONE = { point_a: false, point_b: false, market: false, gri_full: false, pdf_export: false, ai_chat: false, benchmarks: false, gri_full_unlimited: false }

describe('withCompanyRights (pure)', () => {
  it('a Free member of a Pro company gets every paid section and the unlimited GRI', () => {
    const e = withCompanyRights(entitlementsFor('free', {}, 1), {}, parseCompanyRights(PRO_COMPANY))
    for (const f of ['point_a', 'point_b', 'market', 'gri_full', 'pdf_export', 'ai_chat', 'benchmarks'] as const) expect(can(e, f), f).toBe(true)
    expect(e.tier).toBe('free') // his own tariff is still shown as it is
    expect(e.viaCompany).toEqual(expect.arrayContaining(['point_a', 'market', 'gri_full']))
    expect(canRunFullGri(e, 500)).toBe(true)
  })

  it('the member\'s own explicit false is not reopened by the company', () => {
    const overrides = { market: false }
    const e = withCompanyRights(entitlementsFor('free', overrides), overrides, parseCompanyRights(PRO_COMPANY))
    expect(e.market).toBe(false)
    expect(e.point_a).toBe(true)
    expect(e.viaCompany).not.toContain('market')
  })

  it('a Free owner with one section opened individually passes exactly that section (with the free GRI limit)', () => {
    const e = withCompanyRights(entitlementsFor('free', {}, 2), {}, parseCompanyRights({ ...NONE, point_a: true, gri_full: true }))
    expect(e).toMatchObject({ point_a: true, gri_full: true, point_b: false, market: false })
    expect(e.gri_full_limit).toBe(2)
  })

  it('no company rights / nothing inherited → the own entitlements unchanged (no viaCompany field)', () => {
    const own = entitlementsFor('free')
    expect(withCompanyRights(own, {}, null)).toBe(own)
    expect(withCompanyRights(own, {}, parseCompanyRights(NONE))).toEqual(own)
    expect(withCompanyRights(own, {}, parseCompanyRights(NONE)).viaCompany).toBeUndefined()
  })

  it('parseCompanyRights takes only literal true of known features', () => {
    expect(parseCompanyRights(null)).toBeNull()
    expect(parseCompanyRights('admin')).toBeNull()
    expect(parseCompanyRights([true])).toBeNull()
    expect(parseCompanyRights({ point_a: 'true', market: 1, hacked: true, gri_full: true })).toEqual({ features: { gri_full: true }, griUnlimited: false })
  })

  it('needsCompanyRights: Pro without explicit «false» never asks; Free always does; an explicit false alone does not', () => {
    expect(needsCompanyRights(entitlementsFor('pro'), {})).toBe(false)
    expect(needsCompanyRights(entitlementsFor('free'), {})).toBe(true)
    expect(needsCompanyRights(entitlementsFor('pro', { market: false }), { market: false })).toBe(false)
  })

  it('the decision follows the inherited right (gates on)', () => {
    const e = withCompanyRights(entitlementsFor('free'), {}, parseCompanyRights(PRO_COMPANY))
    expect(decideFeature({ gatesEnabled: true, ent: e }, 'market')).toEqual({ allowed: true, reason: 'entitled' })
    expect(decideFeature({ gatesEnabled: true, ent: entitlementsFor('free') }, 'market').allowed).toBe(false)
  })
})

describe('readEntitlements asks the company only when needed', () => {
  function client(profile: Record<string, unknown> | null, rpcReply: { data: unknown; error: unknown } | Error) {
    const rpc = vi.fn(async () => {
      if (rpcReply instanceof Error) throw rpcReply
      return rpcReply
    })
    return {
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }),
    }
  }

  it('Free member → the RPC company_inherited_rights for himself → inherited sections', async () => {
    const sb = client({ tier: 'free', feature_flags: {} }, { data: PRO_COMPANY, error: null })
    const e = await readEntitlements(sb as never, 'u-1')
    expect(sb.rpc).toHaveBeenCalledWith('company_inherited_rights', { p_user: 'u-1' })
    expect(e).toMatchObject({ point_a: true, point_b: true, market: true, gri_full: true })
  })

  it('Pro → no RPC at all', async () => {
    const sb = client({ tier: 'pro', feature_flags: {} }, { data: NONE, error: null })
    const e = await readEntitlements(sb as never, 'u-1')
    expect(sb.rpc).not.toHaveBeenCalled()
    expect(e.point_a).toBe(true)
  })

  it('the RPC fails / migration 148 absent / it throws → no inheritance (closed), own rights kept', async () => {
    for (const reply of [{ data: null, error: { code: 'PGRST202', message: 'no function' } }, new Error('offline')]) {
      const sb = client({ tier: 'free', feature_flags: { point_b: true } }, reply)
      const e = await readEntitlements(sb as never, 'u-1')
      expect(e).toMatchObject({ point_a: false, market: false, point_b: true })
      expect(e.viaCompany).toBeUndefined()
    }
  })

  it('a client without .rpc (old fakes, other callers) → own rights only', async () => {
    const sb = { from: client({ tier: 'free', feature_flags: {} }, { data: PRO_COMPANY, error: null }).from }
    expect((await readEntitlements(sb as never, 'u-1')).point_a).toBe(false)
  })
})
