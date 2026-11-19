/**
 * R5 review (wave 1B, M-1): who is «staff» and who is «paid» for the AI budget is decided by the
 * project's own resolvers, not by profiles.role / profiles.tier alone:
 *   • staff — lib/access/actor.ts resolveActor (migration 140: a staff_roles row of an approved
 *     profile, or an active expert). An invited staff member or a role granted in GIGA keeps
 *     profiles.role = 'client'; a legacy profiles.role admin WITHOUT staff_roles is not staff;
 *   • paid — lib/access/server.ts readEntitlements: the own tariff, a feature_flags override, or
 *     the tariff of a company the user is an active member of (migration 148, PO decision Q3).
 * When the meter is down, those users go through (fail-open, loudly); a free or unknown user is
 * refused with 503. These tests run the REAL resolution; only the reads underneath are faked:
 * the PostgREST fetches of resolveActor, and the service client of readEntitlements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER = '11111111-2222-3333-4444-555555555555'

interface World {
  profile: { role: string; status: string; tier: string; feature_flags: Record<string, boolean> } | null
  staff: { role: string; client_scope?: string } | null
  companyRights: Record<string, boolean> | null
  /** PostgREST down for resolveActor. */
  restDown: boolean
  /** The service client cannot read profiles. */
  profilesDown: boolean
}
const w = vi.hoisted(() => ({ state: null as unknown as World }))

vi.mock('@/lib/settings/store', () => ({ getSetting: async () => undefined }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table !== 'profiles') return { data: null, error: { message: `unexpected table ${table}` } }
            if (w.state.profilesDown) return { data: null, error: { message: 'profiles down' } }
            return { data: w.state.profile, error: null }
          },
        }),
      }),
    }),
    rpc: async (fn: string) => {
      if (fn !== 'company_inherited_rights') return { data: null, error: { message: `unexpected rpc ${fn}` } }
      return { data: w.state.companyRights, error: null }
    },
  }),
}))

const fetchStub = vi.fn(async (input: string | URL) => {
  const url = String(input)
  if (w.state.restDown) return new Response('down', { status: 503 })
  if (url.includes('/rest/v1/profiles?')) {
    const p = w.state.profile
    return Response.json(p ? [{ role: p.role, status: p.status }] : [])
  }
  if (url.includes('/rest/v1/staff_roles?')) return Response.json(w.state.staff ? [w.state.staff] : [])
  return new Response('not found', { status: 404 })
})

const { __setAiBudgetDeps, assertAiBudget, AiBudgetUnavailableError, AiBudgetExceededError } = await import('@/lib/ai/budget')

const meterDown = { readSpentTodayUsd: async () => { throw new Error('rpc missing') } }
const limits = { readLimitUsd: async (tier: string) => (tier === 'staff' ? 20 : tier === 'pro' ? 5 : 0.5) }

function world(over: Partial<World> = {}): void {
  w.state = {
    profile: { role: 'client', status: 'approved', tier: 'free', feature_flags: {} },
    staff: null,
    companyRights: null,
    restDown: false,
    profilesDown: false,
    ...over,
  }
}

let loud: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  world()
  vi.stubGlobal('fetch', fetchStub)
  loud = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  __setAiBudgetDeps(null)
  vi.unstubAllGlobals()
  loud.mockRestore()
})

describe('AI budget tier through the official resolvers — meter down', () => {
  it('an invited staff member (staff_roles row, profiles.role = client) goes through, loudly', async () => {
    world({ staff: { role: 'crm_manager' } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
    expect(String(loud.mock.calls.at(-1)?.[0])).toMatch(/staff user let through \(fail-open\)/)
  })

  it('an active expert (profiles.role = expert, approved) counts as staff', async () => {
    world({ profile: { role: 'expert', status: 'approved', tier: 'free', feature_flags: {} } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
  })

  it('a free member of a paid company (148, Q3) goes through as paid', async () => {
    world({ companyRights: { point_a: true, point_b: true, market: true, gri_full: true, ai_chat: true } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
    expect(String(loud.mock.calls.at(-1)?.[0])).toMatch(/pro user let through \(fail-open\)/)
  })

  it('a free account with a feature_flags override (opened in GIGA) goes through as paid', async () => {
    world({ profile: { role: 'client', status: 'approved', tier: 'free', feature_flags: { ai_chat: true } } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
  })

  it('a pro account goes through', async () => {
    world({ profile: { role: 'client', status: 'approved', tier: 'pro', feature_flags: {} } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
  })

  it('a plain free client is refused with 503', async () => {
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
  })

  it('the legacy profiles.role admin WITHOUT staff_roles is not staff (migration 140) — refused', async () => {
    world({ profile: { role: 'admin', status: 'approved', tier: 'free', feature_flags: {} } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
  })

  it('a staff_roles row of a NOT approved profile is not staff — refused', async () => {
    world({ profile: { role: 'client', status: 'pending', tier: 'free', feature_flags: {} }, staff: { role: 'admin' } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
  })

  it('staff unreadable and no paid access: unknown — refused with 503', async () => {
    world({ restDown: true, staff: { role: 'admin' } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
  })

  it('staff unreadable but the account is paid: still goes through as paid', async () => {
    world({ restDown: true, profile: { role: 'client', status: 'approved', tier: 'pro', feature_flags: {} } })
    __setAiBudgetDeps({ ...limits, ...meterDown })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
  })
})

describe('AI budget tier through the official resolvers — meter up', () => {
  it('an invited staff member gets the staff limit, not the free one', async () => {
    world({ staff: { role: 'support' } })
    __setAiBudgetDeps({ ...limits, readSpentTodayUsd: async () => 6 })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
  })

  it('a member of a paid company gets the pro limit; over it — 429 with tier pro', async () => {
    world({ companyRights: { ai_chat: true } })
    __setAiBudgetDeps({ ...limits, readSpentTodayUsd: async () => 1 })
    await expect(assertAiBudget(USER, 'ai_chat')).resolves.toBeUndefined()
    __setAiBudgetDeps({ ...limits, readSpentTodayUsd: async () => 5 })
    const err = await assertAiBudget(USER, 'ai_chat').catch((e) => e)
    expect(err).toBeInstanceOf(AiBudgetExceededError)
    expect(err).toMatchObject({ status: 429, tier: 'pro', limitUsd: 5 })
  })

  it('a free client keeps the free limit', async () => {
    __setAiBudgetDeps({ ...limits, readSpentTodayUsd: async () => 0.5 })
    await expect(assertAiBudget(USER, 'ai_chat')).rejects.toMatchObject({ status: 429, tier: 'free', limitUsd: 0.5 })
  })
})
