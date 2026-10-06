/**
 * Reading the resolver inputs (lib/metrics/materialize.ts gatherResolverContext):
 * a failed read of ANY input — survey answers, documents or the GRI
 * assessment — throws. «Could not read» must never look like «no inputs»:
 * materializeAll deletes the rows of metrics that no longer resolve, so a
 * swallowed GRI error used to wipe the gri.* values and everything calculated
 * from them (#9).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gatherResolverContext } from '@/lib/metrics/materialize'
import { materializeForTenant } from '@/lib/metrics/materialize-tenant'

type Res = { data: unknown; error: { code?: string; message: string } | null }

function client(results: Record<string, Res>) {
  const deletes = vi.fn()
  const from = vi.fn((table: string) => {
    const res = results[table] ?? { data: [], error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'or', 'in', 'order', 'limit', 'upsert']) b[m] = () => b
    b.delete = () => { deletes(table); return b }
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(res.data) ? res.data[0] ?? null : res.data, error: res.error })
    b.then = (ok: (r: Res) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, err)
    return b
  })
  return { client: { from } as unknown as SupabaseClient, deletes }
}

const OK_SURVEY: Res = { data: [{ question_key: 's1_current_revenue_year', answer: { value: 66_000_000 } }], error: null }

describe('gatherResolverContext: read failures throw', () => {
  it('a failed GRI assessment read throws (was: «no assessment»)', async () => {
    const { client: c } = client({ survey_answers: OK_SURVEY, gri_assessments: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } })
    await expect(gatherResolverContext(c, { userId: 'u', companyId: 'co', documentsScope: 'company' })).rejects.toThrow(/GRI assessment read failed \(57014\)/)
  })

  it('materialisation stops before any delete when the GRI read fails', async () => {
    const { client: c, deletes } = client({
      companies: { data: { user_id: 'owner' }, error: null },
      survey_answers: OK_SURVEY,
      gri_assessments: { data: null, error: { code: '08006', message: 'connection failure' } },
      metrics: { data: [{ id: 'm1', metric_key: 'gri.komanda', source: 'calculated', period_year: null, period_quarter: null }], error: null },
    })
    await expect(materializeForTenant(c, c, { companyId: 'co', userId: 'owner', role: 'owner' })).rejects.toThrow(/GRI assessment read failed/)
    expect(deletes).not.toHaveBeenCalled()
  })

  it('no assessment (empty result) is not an error', async () => {
    const { client: c } = client({ survey_answers: OK_SURVEY })
    const ctx = await gatherResolverContext(c, { userId: 'u', companyId: 'co' })
    expect(ctx.griSections).toBeNull()
    expect(ctx.surveyAnswers.s1_current_revenue_year).toBe(66_000_000)
  })
})

describe('tenant inputs: owner attribution', () => {
  it('a member of a company without a primary owner gets an error, not their own (empty) inputs', async () => {
    const { client: c, deletes } = client({ companies: { data: { user_id: null }, error: null } })
    await expect(materializeForTenant(c, c, { companyId: 'co', userId: 'member', role: 'member' })).rejects.toThrow(/no primary owner/)
    expect(deletes).not.toHaveBeenCalled()
  })

  it('a failed owner lookup throws instead of falling back to the caller', async () => {
    const { client: c } = client({ companies: { data: null, error: { code: '42501', message: 'denied' } } })
    await expect(materializeForTenant(c, c, { companyId: 'co', userId: 'member', role: 'member' })).rejects.toThrow(/company owner read failed/)
  })
})
