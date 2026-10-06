/**
 * Legacy /api/v1/admin/* guard: approved platform admins only, and no action
 * on staff of equal or higher rank (an admin cannot block a super_admin).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@x.kz' } as { id: string; email: string } | null,
  roles: {} as Record<string, { staffRole: string | null; profileRole: string | null; status: string | null; email: string | null }>,
  mfa: 'ok' as 'ok' | 'step_up' | 'enroll',
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/admin/giga-actor', () => ({
  staffRoleOfUser: async (id: string) => state.roles[id] ?? { staffRole: null, profileRole: 'client', status: 'approved', email: null },
  staffMfaGate: async () => state.mfa,
}))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))

const { requireSupabaseAdmin, forbidLegacyTarget } = await import('@/lib/supabase-admin-guard')

const ME = '11111111-1111-4111-8111-111111111111'
const SUPER = '22222222-2222-4222-8222-222222222222'
const CLIENT = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  state.mfa = 'ok'
  state.user = { id: ME, email: 'a@x.kz' }
  state.roles = {
    [ME]: { staffRole: null, profileRole: 'admin', status: 'approved', email: 'a@x.kz' },
    [SUPER]: { staffRole: 'super_admin', profileRole: 'super_admin', status: 'approved', email: 's@x.kz' },
  }
})

describe('legacy admin guard', () => {
  it('admits an approved admin', async () => {
    const g = await requireSupabaseAdmin()
    expect('error' in g ? g.error.status : g.role).toBe('admin')
  })

  it('refuses a blocked admin and a non-admin', async () => {
    state.roles[ME].status = 'blocked'
    let g = await requireSupabaseAdmin()
    expect('error' in g && g.error.status).toBe(403)
    state.roles[ME] = { staffRole: null, profileRole: 'expert', status: 'approved', email: null }
    g = await requireSupabaseAdmin()
    expect('error' in g && g.error.status).toBe(403)
  })

  it('refuses an admin who has a second factor but did not pass it in this session', async () => {
    state.mfa = 'step_up'
    const g = await requireSupabaseAdmin()
    expect('error' in g && g.error.status).toBe(403)
    expect('error' in g && (await g.error.json()).code).toBe('MFA_STEP_UP_REQUIRED')
  })

  it('refuses anonymous callers', async () => {
    state.user = null
    const g = await requireSupabaseAdmin()
    expect('error' in g && g.error.status).toBe(401)
  })

  it('an admin may act on clients but not on a super_admin or on themselves', async () => {
    const g = await requireSupabaseAdmin()
    if ('error' in g) throw new Error('guard failed')
    expect(await forbidLegacyTarget(g, CLIENT)).toBeNull()
    expect((await forbidLegacyTarget(g, SUPER))?.status).toBe(403)
    expect((await forbidLegacyTarget(g, ME))?.status).toBe(403)
    expect((await forbidLegacyTarget(g, 'not-a-uuid'))?.status).toBe(400)
  })

  it('a super_admin may act on an admin', async () => {
    state.roles[ME] = { staffRole: 'super_admin', profileRole: 'super_admin', status: 'approved', email: null }
    state.roles[CLIENT] = { staffRole: 'admin', profileRole: 'client', status: 'approved', email: null }
    const g = await requireSupabaseAdmin()
    if ('error' in g) throw new Error('guard failed')
    expect(g.role).toBe('super_admin')
    expect(await forbidLegacyTarget(g, CLIENT)).toBeNull()
  })
})
