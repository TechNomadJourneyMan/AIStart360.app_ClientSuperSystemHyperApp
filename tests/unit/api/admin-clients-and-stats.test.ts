/**
 * Staff client lists and stats count clients only (CLIENT_PROFILE_ROLES —
 * staff, experts and partners are profiles too), report failed reads as
 * failed, and never show sample numbers:
 *   GET /api/v1/admin/clients — role filter, company/diagnostic read errors → 500;
 *   /clients page — no fallback '44' / '38' / '6' / '763', Point A on its 0–100 scale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CLIENT_PROFILE_ROLES } from '@/lib/profiles/client-roles'

type Filter = [op: string, col: string, val: unknown]
const s = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; filters: Array<[string, string, unknown]>; head: boolean }>,
  failTable: null as string | null,
  profiles: [] as Array<Record<string, unknown>>,
  diagnostics: [] as Array<Record<string, unknown>>,
}))

/** Minimal PostgREST-like builder: records filters, applies eq/in/not/gte to rows. */
function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } }, error: null }) },
    from(table: string) {
      const filters: Filter[] = []
      const call = { table, filters, head: false }
      s.calls.push(call)
      const rowsFor = () => (table === 'profiles' ? s.profiles : table === 'diagnostics' ? s.diagnostics : [])
      const matches = (r: Record<string, unknown>) =>
        filters.every(([op, c, v]) =>
          op === 'eq' ? r[c] === v
            : op === 'in' ? (v as unknown[]).includes(r[c])
              : op === 'not.eq' ? r[c] !== v
                : op === 'not.is' ? r[c] !== null && r[c] !== undefined
                  : op === 'gte' ? String(r[c]) >= String(v)
                    : true)
      const result = () => {
        if (s.failTable === table) return { data: null, count: null, error: { message: 'permission denied', code: '42501' } }
        const rows = rowsFor().filter(matches)
        return { data: call.head ? null : rows, count: rows.length, error: null }
      }
      const b: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => { call.head = Boolean(opts?.head); return b },
        eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return b },
        in: (c: string, v: unknown[]) => { filters.push(['in', c, v]); return b },
        not: (c: string, op: string, v: unknown) => { filters.push([`not.${op}`, c, v]); return b },
        gte: (c: string, v: unknown) => { filters.push(['gte', c, v]); return b },
        order: () => b,
        limit: () => b,
        range: () => b,
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient() }))
vi.mock('@/lib/supabase-admin-guard', () => ({
  requireSupabaseAdmin: async () => ({ user: { id: 'staff-1', email: 's@x' }, role: 'admin' }),
}))
vi.mock('@/components/clients/ClientsTable', () => ({ ClientsTable: () => null }))
vi.mock('@/components/clients/ClientFilters', () => ({ ClientFilters: () => null }))

import { GET } from '@/app/api/v1/admin/clients/route'
import ClientsPage from '@/app/(dashboard)/clients/page'

const profile = (id: string, role: string, status = 'approved') =>
  ({ id, role, status, email: `${id}@x`, full_name: id, approved_at: null, created_at: '2026-10-01T00:00:00Z' })

beforeEach(() => {
  s.calls = []
  s.failTable = null
  s.profiles = [profile('c1', 'client'), profile('o1', 'owner', 'pending_approval'), profile('a1', 'admin'), profile('e1', 'expert')]
  s.diagnostics = [
    { user_id: 'c1', overall_score: 62, is_current: true },
    { user_id: 'o1', overall_score: 48, is_current: true },
    { user_id: 'a1', overall_score: 90, is_current: true },
  ]
})

describe('GET /api/v1/admin/clients', () => {
  it('lists client profiles only', async () => {
    const body = await (await GET()).json()
    expect(body.ok).toBe(true)
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual(['c1', 'o1'])
    const profilesCall = s.calls.find((c) => c.table === 'profiles')!
    expect(profilesCall.filters).toContainEqual(['in', 'role', [...CLIENT_PROFILE_ROLES]])
  })

  it('a failed diagnostics read is an error, not "no diagnostic"', async () => {
    s.failTable = 'diagnostics'
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('permission denied')
  })
})

describe('/clients page stats', () => {
  it('counts clients only and shows the mean Point A score on 0–100', async () => {
    const html = renderToStaticMarkup(await ClientsPage())
    // c1 + o1 are clients; a1 (admin) and e1 (expert) are not.
    expect(html).toMatch(/Всего клиентов<\/p><p[^>]*>2</)
    expect(html).toMatch(/Активных<\/p><p[^>]*>1</)
    expect(html).toMatch(/Ожидают<\/p><p[^>]*>1</)
    expect(html).toContain('55/100') // (62 + 48) / 2, the admin's 90 is not a client's
  })

  it('a failed read shows an error, never sample numbers', async () => {
    s.failTable = 'profiles'
    const html = renderToStaticMarkup(await ClientsPage())
    expect(html).toContain('не удалось загрузить')
    for (const sample of ['>44<', '>38<', '>6<', '>763<', 'Avg GRI', 'Churn Risk']) expect(html).not.toContain(sample)
  })
})
