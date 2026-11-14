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
  }),
}))

const { companyOwnerSectionOpen, ownerSectionOpen, REPORT_SECTION, shareSection } = await import('@/lib/access/owner-access')

beforeEach(() => {
  s.gates = true
  s.closed = new Set()
  s.closedCalls = []
  s.owner = 'owner-1'
  s.ownerError = false
  s.recipientThrows = false
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
})
