import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantWith } from '@/lib/tenancy'

type Rpc = Record<string, (args: Record<string, unknown>) => unknown>

interface FakeOpts {
  rpc?: Rpc
  missingFunctions?: boolean
  members?: Array<{ company_id: string; role: string }> | 'missing-table'
  owned?: string | null
}

/** Minimal stand-in for the PostgREST client: just the calls lib/tenancy makes. */
function fake({ rpc = {}, missingFunctions = false, members = [], owned = null }: FakeOpts): SupabaseClient {
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: table === 'companies' && owned ? { id: owned } : null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (table === 'company_members') {
          resolve(members === 'missing-table'
            ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
            : { data: members, error: null })
        } else {
          resolve({ data: [], error: null })
        }
      },
    }
    return q
  }
  return {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (missingFunctions) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
      const impl = rpc[fn]
      return { data: impl ? impl(args) : null, error: null }
    },
  } as unknown as SupabaseClient
}

describe('resolveTenantWith', () => {
  it('rejects anonymous callers', async () => {
    expect(await resolveTenantWith(fake({}), null)).toEqual({ ok: false, status: 401, error: 'unauthenticated' })
  })

  it('picks the owned company first when none is requested', async () => {
    const client = fake({
      members: [{ company_id: 'c-view', role: 'viewer' }, { company_id: 'c-own', role: 'owner' }],
      rpc: {
        can_read_company: () => true,
        can_manage_company: ({ p_company_id }) => p_company_id === 'c-own',
        company_member_role: ({ p_company_id }) => (p_company_id === 'c-own' ? 'owner' : 'viewer'),
      },
    })
    const res = await resolveTenantWith(client, 'u1')
    expect(res).toEqual({
      ok: true,
      tenant: { userId: 'u1', companyId: 'c-own', role: 'owner', canManage: true, legacy: false },
    })
  })

  it('answers 404 for a company the caller cannot read (no existence oracle)', async () => {
    const client = fake({ rpc: { can_read_company: () => false } })
    expect(await resolveTenantWith(client, 'u1', { companyId: 'someone-else' })).toEqual({
      ok: false, status: 404, error: 'no_company',
    })
  })

  it('reports partner and staff roles', async () => {
    const partner = fake({
      rpc: {
        can_read_company: () => true,
        can_manage_company: () => false,
        partner_role_for_company: () => 'partner_expert',
      },
    })
    const p = await resolveTenantWith(partner, 'u2', { companyId: 'c1' })
    expect(p.ok && p.tenant.role).toBe('partner_expert')
    expect(p.ok && p.tenant.canManage).toBe(false)

    const staff = fake({ rpc: { can_read_company: () => true, is_platform_staff: () => true } })
    const s = await resolveTenantWith(staff, 'u3', { companyId: 'c1' })
    expect(s.ok && s.tenant.role).toBe('staff')
  })

  it('requires manage rights when asked', async () => {
    const client = fake({ rpc: { can_manage_company: () => false, can_read_company: () => true } })
    expect(await resolveTenantWith(client, 'u1', { companyId: 'c1', access: 'manage' })).toMatchObject({
      ok: false, status: 404,
    })
  })

  it('falls back to the single-owner rule before migration 084 is applied', async () => {
    const before084 = fake({ missingFunctions: true, members: 'missing-table', owned: 'c-legacy' })
    expect(await resolveTenantWith(before084, 'u1')).toEqual({
      ok: true,
      tenant: { userId: 'u1', companyId: 'c-legacy', role: 'owner', canManage: true, legacy: true },
    })
    expect(await resolveTenantWith(before084, 'u1', { companyId: 'c-other' })).toEqual({
      ok: false, status: 404, error: 'no_company',
    })
  })

  it('returns no_company for a user without any company', async () => {
    expect(await resolveTenantWith(fake({}), 'u1')).toEqual({ ok: false, status: 404, error: 'no_company' })
  })
})
