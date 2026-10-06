/**
 * lib/tenancy: only a MISSING company_members table (084 not applied) selects
 * the legacy single-owner rule. Any other error (timeout, PostgREST 5xx) used to
 * take the legacy branch too and end in a false 404 'no_company'
 * ("Компания не найдена") for members; it now throws so the route answers 5xx.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantWith } from '@/lib/tenancy'

type Err = { code?: string; message?: string } | null

function fake(opts: { membersError?: Err; members?: Array<{ company_id: string; role: string }>; companiesError?: Err; owned?: string | null }): SupabaseClient {
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: table === 'companies' && opts.owned ? { id: opts.owned } : null,
        error: table === 'companies' ? opts.companiesError ?? null : null,
      }),
      then: (resolve: (v: unknown) => void) =>
        resolve(table === 'company_members'
          ? { data: opts.membersError ? null : opts.members ?? [], error: opts.membersError ?? null }
          : { data: [], error: null }),
    }
    return q
  }
  return {
    from: query,
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
  } as unknown as SupabaseClient
}

describe('resolveTenantWith — lookup errors', () => {
  it('a transient company_members failure throws instead of reporting no_company', async () => {
    await expect(resolveTenantWith(fake({ membersError: { code: '57014', message: 'canceling statement due to statement timeout' } }), 'u1'))
      .rejects.toThrow(/company_members/)
  })

  it('a missing company_members table still uses the legacy owner rule', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      const res = await resolveTenantWith(fake({ membersError: { code, message: 'missing' }, owned: 'c-1' }), 'u1')
      expect(res).toEqual({ ok: true, tenant: { userId: 'u1', companyId: 'c-1', role: 'owner', canManage: true, legacy: true } })
    }
  })

  it('a failing companies lookup throws instead of reporting no_company', async () => {
    await expect(resolveTenantWith(fake({ membersError: { code: '42P01' }, companiesError: { code: '08006', message: 'connection failure' } }), 'u1'))
      .rejects.toThrow(/companies lookup/)
    await expect(resolveTenantWith(fake({ companiesError: { code: '08006' } }), 'u1')).rejects.toThrow(/companies lookup/)
  })

  it('no membership and no owned company is still a plain no_company', async () => {
    expect(await resolveTenantWith(fake({}), 'u1')).toEqual({ ok: false, status: 404, error: 'no_company' })
  })
})
