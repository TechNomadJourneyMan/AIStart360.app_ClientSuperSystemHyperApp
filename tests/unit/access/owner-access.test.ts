/**
 * R2-C: lib/access/owner-access.ts — the decision public links use: the
 * owner's CURRENT right (gates, tariff, override, company inheritance; staff do
 * not count), failing closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  gates: true,
  closed: new Set<string>(),
  closedCalls: [] as Array<{ user: string; section: string }>,
  owner: 'owner-1' as string | null,
  ownerError: false,
  recipientThrows: false,
  rpc: [] as Array<{ fn: string; args: { p_company_ids: string[]; p_section: string } }>,
  rpcFails: false,
}))

vi.mock('@/lib/settings/system-settings', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/access/recipient', () => ({
  sectionClosedFor: async (user: string, section: string) => {
    s.closedCalls.push({ user, section })
    if (s.recipientThrows) throw new Error('db down')
    return s.closed.has(`${user}:${section}`)
  },
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (s.ownerError ? { data: null, error: { message: 'x' } } : { data: s.owner === null ? { user_id: null } : { user_id: s.owner }, error: null }) }) }) }),
    rpc: async (fn: string, args: { p_company_ids?: string[]; p_user_ids?: string[]; p_section: string }) => {
      s.rpc.push({ fn, args: args as never })
      if (s.rpcFails) return { data: null, error: { message: 'down' } }
      if (fn === 'paid_sections_for_users') return { data: (args.p_user_ids ?? []).map((id) => ({ user_id: id, open: !id.startsWith('f') })), error: null }
      return { data: (args.p_company_ids ?? []).filter((id) => id !== 'gone').map((id) => ({ company_id: id, owner_id: `o-${id}`, open: !id.startsWith('free') })), error: null }
    },
  }),
}))

const { companiesOwnerSectionOpen, companiesWithClosedSection, companyOwnerSectionOpen, ownerSectionOpen, REPORT_SECTION, shareSection, usersWithClosedSection } = await import('@/lib/access/owner-access')

beforeEach(() => {
  s.gates = true
  s.closed = new Set()
  s.closedCalls = []
  s.owner = 'owner-1'
  s.ownerError = false
  s.recipientThrows = false
  s.rpc = []
  s.rpcFails = false
})

describe('owner-access', () => {
  it('share types map to their sections; the questionnaire is free; the report is Точка А', () => {
    expect(shareSection('point_a')).toBe('point_a')
    expect(shareSection('point_b')).toBe('point_b')
    expect(shareSection('gri')).toBe('gri_full')
    expect(shareSection('survey')).toBeNull()
    expect(REPORT_SECTION).toBe('point_a')
  })

  it('asks the recipient decision for the owner (no staff), per section', async () => {
    s.closed.add('owner-1:point_b')
    expect(await ownerSectionOpen('owner-1', 'point_a')).toBe(true)
    expect(await ownerSectionOpen('owner-1', 'point_b')).toBe(false)
    expect(s.closedCalls).toEqual([{ user: 'owner-1', section: 'point_a' }, { user: 'owner-1', section: 'point_b' }])
  })

  it('no owner: open only while the gates are off; any failure → closed', async () => {
    expect(await ownerSectionOpen(null, 'point_a')).toBe(false)
    s.gates = false
    expect(await ownerSectionOpen(null, 'point_a')).toBe(true)
    s.recipientThrows = true
    expect(await ownerSectionOpen('owner-1', 'point_a')).toBe(false)
  })

  it('by company: the owner is companies.user_id; a failed read → closed', async () => {
    expect(await companyOwnerSectionOpen('c-1', 'point_a')).toBe(true)
    expect(s.closedCalls.at(-1)).toEqual({ user: 'owner-1', section: 'point_a' })
    s.closed.add('owner-1:point_a')
    expect(await companyOwnerSectionOpen('c-1', 'point_a')).toBe(false)
    s.ownerError = true
    s.closed.clear()
    expect(await companyOwnerSectionOpen('c-1', 'point_a')).toBe(false)
    s.ownerError = false
    s.owner = null
    expect(await companyOwnerSectionOpen('c-1', 'point_a')).toBe(false)
  })

  it('review F8: the owners of MANY companies in ONE call (SQL paid_sections_for_owners), duplicates and empties dropped', async () => {
    const open = await companiesOwnerSectionOpen(['c1', 'free-2', 'c1', '', 'gone'], 'point_a')
    expect(s.rpc).toHaveLength(1)
    expect(s.rpc[0]).toEqual({ fn: 'paid_sections_for_owners', args: { p_company_ids: ['c1', 'free-2', 'gone'], p_section: 'point_a' } })
    expect(Object.fromEntries(open)).toEqual({ c1: true, 'free-2': false })
    expect(await companiesWithClosedSection(['c1', 'free-2'], 'point_a')).toEqual(new Set(['free-2']))
    expect((await companiesOwnerSectionOpen([], 'point_a')).size).toBe(0)
  })

  it('review L-7: a failed batch is UNKNOWN — no company is reported as «closed» (no misleading free-tariff note)', async () => {
    s.rpcFails = true
    expect((await companiesOwnerSectionOpen(['c1', 'free-2'], 'point_a')).size).toBe(0)
    expect((await companiesWithClosedSection(['c1', 'free-2'], 'point_a')).size).toBe(0)
  })

  it('verify H-1: given CLIENTS in ONE call (SQL paid_sections_for_users); only known-closed ones; a failure → none', async () => {
    const F = 'f0000000-0000-4000-8000-000000000001'
    const P = 'a0000000-0000-4000-8000-000000000002'
    expect(await usersWithClosedSection([F, P, F, 'not-a-uuid'], 'point_a')).toEqual(new Set([F]))
    expect(s.rpc.at(-1)).toEqual({ fn: 'paid_sections_for_users', args: { p_user_ids: [F, P], p_section: 'point_a' } })
    s.rpcFails = true
    expect((await usersWithClosedSection([F], 'point_a')).size).toBe(0)
  })
})
