/**
 * lib/point-b/compat.ts — the «expert version» for consumers that predate the plan: the published
 * plan version first, the latest approved legacy version as the fallback, drafts never.
 */
import { describe, expect, it, vi } from 'vitest'
import { loadExpertVersionForClient, loadLatestExpertNotes } from '@/lib/point-b/compat'
import { pbDb } from './_pbdb'

const COMPANY = 'company-1'
const legacy = (over: Record<string, unknown>) => ({
  id: 'pb-1', diagnostic_id: 'diag-1', expert_notes: 'Старая одобренная', author_name: 'Алия', is_approved: true, created_at: '2026-09-01T00:00:00Z', ...over,
})
const ver = (over: Record<string, unknown>) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', goals: { primary: null, items: [] }, expert_notes: 'Из плана', author_name: 'Анна Эксперт',
  approved_at: '2026-10-11T00:00:00Z', created_at: '2026-10-09T00:00:00Z', ...over,
})
const plan = { id: 'plan-1', company_id: COMPANY, user_id: 'u-1', current_version_id: null, published_version_id: 'v-1', settings: {}, created_at: 'x', updated_at: 'x' }
const key = { companyId: COMPANY, diagnosticId: 'diag-1' }

describe('loadExpertVersionForClient', () => {
  it('returns the published plan version with a display name and the approval time', async () => {
    const { sb } = pbDb({ pb_plans: [plan], pb_plan_versions: [ver({}), ver({ id: 'v-2', version: 2, status: 'draft', expert_notes: 'черновик' })], point_b_versions: [legacy({})] })
    expect(await loadExpertVersionForClient(sb, key)).toEqual({ expert_notes: 'Из плана', author_name: 'Анна Эксперт', created_at: '2026-10-11T00:00:00Z' })
  })

  it('falls back to the latest APPROVED legacy version, with the email hidden', async () => {
    const { sb } = pbDb({ point_b_versions: [legacy({ author_name: 'expert@staff.io' }), legacy({ id: 'pb-2', is_approved: false, expert_notes: 'черновик', created_at: '2026-10-01T00:00:00Z' })] })
    expect(await loadExpertVersionForClient(sb, key)).toEqual({ expert_notes: 'Старая одобренная', author_name: 'Эксперт AIStart360', created_at: '2026-09-01T00:00:00Z' })
  })

  it('a plan with only drafts / versions in review falls back to the legacy approved one; none anywhere → null', async () => {
    const onlyDraft = pbDb({ pb_plans: [{ ...plan, published_version_id: null }], pb_plan_versions: [ver({ status: 'in_review', expert_notes: 'на проверке' })], point_b_versions: [legacy({})] })
    expect((await loadExpertVersionForClient(onlyDraft.sb, key))?.expert_notes).toBe('Старая одобренная')
    expect(await loadExpertVersionForClient(pbDb().sb, key)).toBeNull()
    expect(await loadExpertVersionForClient(pbDb().sb, { companyId: null, diagnosticId: null })).toBeNull()
  })

  it('a published plan without notes is null (the legacy text is not resurrected)', async () => {
    const { sb } = pbDb({ pb_plans: [plan], pb_plan_versions: [ver({ expert_notes: null })], point_b_versions: [legacy({})] })
    expect(await loadExpertVersionForClient(sb, key)).toBeNull()
  })

  it('an unreadable plan is logged and the legacy version is used', async () => {
    const base = pbDb({ point_b_versions: [legacy({})] })
    const sb = { from: (t: string) => { if (t === 'pb_plans') throw new Error('boom'); return base.sb.from(t) } } as never
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await loadExpertVersionForClient(sb, key))?.expert_notes).toBe('Старая одобренная')
  })
})

describe('loadLatestExpertNotes', () => {
  it('takes the newest plan version with notes in ANY status, then the newest legacy row', async () => {
    const { sb } = pbDb({
      pb_plans: [plan],
      pb_plan_versions: [ver({}), ver({ id: 'v-2', version: 2, status: 'draft', expert_notes: 'свежий черновик' }), ver({ id: 'v-3', version: 3, status: 'draft', expert_notes: null })],
    })
    expect(await loadLatestExpertNotes(sb, key)).toEqual({ expert_notes: 'свежий черновик' })
    const old = pbDb({ point_b_versions: [legacy({}), legacy({ id: 'pb-2', is_approved: false, expert_notes: 'новее', created_at: '2026-10-01T00:00:00Z' })] })
    expect(await loadLatestExpertNotes(old.sb, key)).toEqual({ expert_notes: 'новее' })
    expect(await loadLatestExpertNotes(pbDb().sb, key)).toBeNull()
  })
})
