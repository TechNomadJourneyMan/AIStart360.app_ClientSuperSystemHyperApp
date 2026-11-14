/**
 * R2-A: POST /api/v1/diagnostics/recalculate stays free (the questionnaire and
 * the express assessment trigger it), but its answer carries no Point A numbers
 * for an account without the paid section — Point A must not leak through it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({ gates: true, tier: 'free' as 'free' | 'pro', role: 'client' }))

function db() {
  const rows: Record<string, unknown> = {
    survey_answers: [{ question_key: 's1_company_name', answer: { value: 'Ромашка' } }],
    companies: { id: 'c-1' },
  }
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) q[m] = () => q
      q.maybeSingle = async () => ({ data: rows[t] ?? null, error: null })
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows[t] ?? null, error: null }).then(res)
      return q
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => db() }))
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-identity')>('@/lib/api-identity')
  return {
    ...real,
    resolveTargetUserId: async () => ({ userId: 'u-1' }),
    getSessionUser: async () => ({ id: 'u-1' }),
    getSessionStaff: async () => (real.isStaffRole(s.role) ? { id: 'u-1', role: s.role } : null),
  }
})
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => s.gates }))
vi.mock('@/lib/access/server', async () => {
  const ent = await import('@/lib/access/entitlements')
  // R2-C (ревью L-11): the decision reads the own rights first, the company only on the refusal path.
  return { readEntitlements: async () => ent.entitlementsFor(s.tier), readOwnEntitlements: async () => ({ ent: ent.entitlementsFor(s.tier), overrides: ent.normalizeOverrides({}) }), readCompanyRights: async () => null }
})
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: () => undefined }))
vi.mock('@/lib/notifications/product', () => ({ notifyPointARecalculated: async () => undefined }))
vi.mock('@/lib/background', () => ({ runInBackground: () => undefined }))
vi.mock('@/lib/point-a/snapshot', () => ({
  buildPointASnapshot: async () => ({
    status: 'written', assessment: 'full', scored: true, diagnosticId: 'd-1', snapshotId: 's-1', engine: 'v4',
    diagnostic: { id: 'd-1', overall_score: 61, blocks: { finance: 64 } },
    written: { overall_score: 61, stage: 'growth', finance_score: 64 },
  }),
}))

const { POST } = await import('@/app/api/v1/diagnostics/recalculate/route')
const call = async () => (await POST(new NextRequest('http://t/api/v1/diagnostics/recalculate', { method: 'POST', body: '{}' }))).json()

beforeEach(() => {
  s.gates = true
  s.tier = 'free'
  s.role = 'client'
})

describe('recalculate answer and the paid Point A', () => {
  it('Free (gates on): the recalculation runs, the answer has no Point A numbers', async () => {
    const body = await call()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({ scored: true, assessment: 'full' })
    expect(JSON.stringify(body)).not.toContain('61')
  })

  it('Pro, staff and gates off get the full answer as before', async () => {
    s.tier = 'pro'
    expect((await call()).data.point_a.overall_score).toBe(61)
    s.tier = 'free'
    s.role = 'admin'
    expect((await call()).data.diagnostic.id).toBe('d-1')
    s.role = 'client'
    s.gates = false
    expect((await call()).data.snapshot_id).toBe('s-1')
  })
})
