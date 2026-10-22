/**
 * resolveTenantWith asks the access check, the role helpers and the manage right in ONE round trip (W4),
 * and a helper whose answer is not needed cannot fail the request.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantWith } from '@/lib/tenancy'

const COMPANY = 'company-1'
type Answer = unknown | { fail: string }

/** RPCs answer on the next macrotask; counts how many were in flight together and the round trips. */
function client(answers: Record<string, Answer>, members: Array<{ company_id: string; role: string }> = []) {
  let inFlight = 0
  let maxInFlight = 0
  const calls: string[] = []
  const sb = {
    from: () => {
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: members, error: null }),
      }
      return q
    },
    rpc: (fn: string) => {
      calls.push(fn)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise((resolve) => setTimeout(() => {
        inFlight--
        const a = answers[fn]
        resolve(a && typeof a === 'object' && 'fail' in (a as object)
          ? { data: null, error: { code: (a as { fail: string }).fail, message: 'boom' } }
          : { data: a ?? null, error: null })
      }, 0))
    },
  } as unknown as SupabaseClient
  return { sb, calls, maxInFlight: () => maxInFlight }
}

describe('resolveTenantWith — one round trip for the checks (W4)', () => {
  it('owner: check, role and manage right are asked together; the answer is unchanged', async () => {
    const c = client({ can_read_company: true, company_member_role: 'owner', can_manage_company: true })
    const r = await resolveTenantWith(c.sb, 'u1', { companyId: COMPANY })
    expect(r).toEqual({ ok: true, tenant: { userId: 'u1', companyId: COMPANY, role: 'owner', canManage: true, legacy: false } })
    expect(c.maxInFlight()).toBe(5)
  })

  it('the role keeps its priority: member before partner before staff', async () => {
    const both = client({ can_read_company: true, company_member_role: 'viewer', partner_role_for_company: 'partner_admin', is_platform_staff: true })
    expect(await resolveTenantWith(both.sb, 'u1', { companyId: COMPANY })).toMatchObject({ ok: true, tenant: { role: 'viewer', canManage: false } })
    const partner = client({ can_read_company: true, partner_role_for_company: 'partner_expert', is_platform_staff: true })
    expect(await resolveTenantWith(partner.sb, 'u1', { companyId: COMPANY })).toMatchObject({ ok: true, tenant: { role: 'partner_expert' } })
    const staff = client({ can_read_company: true, is_platform_staff: true })
    expect(await resolveTenantWith(staff.sb, 'u1', { companyId: COMPANY })).toMatchObject({ ok: true, tenant: { role: 'staff' } })
  })

  it('a failing helper that is not needed does not fail the request; a needed one still does', async () => {
    const memberFound = client({ can_read_company: true, company_member_role: 'admin', partner_role_for_company: { fail: 'XX000' }, is_platform_staff: { fail: 'XX000' } })
    expect(await resolveTenantWith(memberFound.sb, 'u1', { companyId: COMPANY })).toMatchObject({ ok: true, tenant: { role: 'admin' } })

    const denied = client({ can_read_company: false, company_member_role: { fail: 'XX000' }, can_manage_company: { fail: 'XX000' } })
    expect(await resolveTenantWith(denied.sb, 'u1', { companyId: COMPANY })).toEqual({ ok: false, status: 404, error: 'no_company' })

    const roleBroken = client({ can_read_company: true, company_member_role: { fail: 'XX000' } })
    await expect(resolveTenantWith(roleBroken.sb, 'u1', { companyId: COMPANY })).rejects.toThrow(/company_member_role failed/)
  })

  it('manage access: the manage check is the gate, no second manage call', async () => {
    const c = client({ can_manage_company: true, company_member_role: 'owner' })
    expect(await resolveTenantWith(c.sb, 'u1', { companyId: COMPANY, access: 'manage' })).toMatchObject({ ok: true, tenant: { canManage: true, role: 'owner' } })
    expect(c.calls.filter((f) => f === 'can_manage_company')).toHaveLength(1)
  })
})
