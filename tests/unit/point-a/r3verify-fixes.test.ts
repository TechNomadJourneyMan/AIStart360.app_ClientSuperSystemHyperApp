/**
 * R3-VERIFY (независимая проверка R3-PA):
 *   N1  the AI hypotheses catch-up of a bulk «→ Pro» runs inside the client's
 *       pool slot (catchUpPaidAiBatch, ≤ 2 at once — the rule after the 504 of
 *       2026-10-15): 8 clients → never more than 2 generations at a time, and
 *       the batch ends only when all of them are done;
 *   N3  «Подтвердить» / «Сохранить» of the expert's review → 409 «Разбор
 *       обновился» when the AI text was regenerated in the same row after the
 *       panel opened it (the version the panel sends; atomically by
 *       ai_generated_at in the UPDATE).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { slaDb, type Row } from '../expert-sla/_fake'

vi.mock('@/lib/access/decision', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/access/decision')),
  resolveFeature: async () => ({ allowed: true, reason: 'entitled', ent: {}, gatesEnabled: true }),
}))
vi.mock('@/lib/point-a/official', async () => ({ ...(await vi.importActual<Record<string, unknown>>('@/lib/point-a/official')), getOfficialPointA: async () => ({ state: 'scored' }) }))

// The mocked modules are imported once up front: catchUpPaidAi imports them lazily, and two
// clients starting together must both get the mock.
await import('@/lib/access/decision')
await import('@/lib/point-a/official')
const { catchUpPaidAi } = await import('@/lib/point-a/diagnostic-row')
const { catchUpPaidAiAwaited, catchUpPaidAiBatch } = await import('@/lib/point-a/catch-up-batch')
const { loadAiReview, saveAiReview } = await import('@/lib/point-a/ai-review-store')
const { AiReviewBodySchema } = await import('@/lib/point-a/ai-review-route')

describe('N1 — hypotheses catch-up of a bulk «→ Pro» stays within the pool of 2', () => {
  it('8 clients → at most 2 hypothesis generations at once; the batch ends when all 8 are done', async () => {
    let active = 0
    let peak = 0
    const done: string[] = []
    const hypotheses = async (u: string) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 15))
      active -= 1
      done.push(u)
    }
    // A client already analysed: only the hypotheses are left to catch up.
    const sb = { from: () => { const b: Record<string, unknown> = {}; const self = () => b; Object.assign(b, { select: self, eq: self, maybeSingle: async () => ({ data: { id: 'd', ai_status: 'completed' }, error: null }) }); return b } }
    const ids = Array.from({ length: 8 }, (_, i) => `client-${i}`)
    await catchUpPaidAiBatch(ids, {
      run: (id) => catchUpPaidAiAwaited(id, {
        hasKey: () => true,
        catchUp: (u, d) => catchUpPaidAi(u, { ...d, sb: sb as never, baseUrl: 'https://app.test', hypotheses }),
      }),
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(done.sort()).toEqual([...ids].sort())
  })

  it('one client outside a batch (billing, GIGA one by one): the hypotheses still run, detached', async () => {
    const hypotheses = vi.fn(async () => undefined)
    const sb = { from: () => { const b: Record<string, unknown> = {}; const self = () => b; Object.assign(b, { select: self, eq: self, maybeSingle: async () => ({ data: { id: 'd', ai_status: 'completed' }, error: null }) }); return b } }
    await catchUpPaidAi('solo', { sb: sb as never, baseUrl: 'https://app.test', fire: () => undefined, hypotheses })
    await vi.waitFor(() => expect(hypotheses).toHaveBeenCalledWith('solo'))
  })
})

describe('N3 — the expert never confirms a text he has not seen', () => {
  const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
  const DIAG = 'dddddddd-0000-4000-8000-000000000001'
  const OLD = { executive_summary: 'OLD: резюме', strategic_priorities: [], growth_roadmap: [], blocks: { finance: { diagnosis: 'old' } }, industry_context: 'к' }
  const NEW = { ...OLD, executive_summary: 'NEW: резюме', blocks: { finance: { diagnosis: 'new' }, marketing: { diagnosis: 'NEW d' } } }
  const row = (over: Row = {}): Row => ({
    id: DIAG, user_id: CLIENT, is_current: true, ai_status: 'failed', ai_analysis: { ...OLD, partial: ['blocksB'] }, ai_error: 'blocksB:cut', ai_model: 'm',
    ai_generated_at: '2026-11-15T10:00:00Z', ai_reviewed_at: null, ai_reviewed_by: null, ai_reviewed_by_name: null, ai_expert_edits: null, ...over,
  })
  const actor = { id: 'eeeeeeee-0000-4000-8000-000000000001', name: 'Пётр Эксперт' }
  const regenerate = (r: Row) => Object.assign(r, { ai_status: 'completed', ai_analysis: NEW, ai_error: null, ai_generated_at: '2026-11-15T10:02:00Z' })

  it('regenerated in the same row after the panel opened → 409 «Разбор обновился», nothing written', async () => {
    const w = slaDb({ diagnostics: [row()] })
    const opened = await loadAiReview(w.sb, CLIENT)
    expect(opened.version).toMatch(/^2026-11-15T10:00:00Z#[0-9a-f]{16}$/)
    regenerate(w.db.diagnostics[0])
    const res = await saveAiReview(w.sb, { clientId: CLIENT, diagnosticId: DIAG, edits: { executive_summary: 'OLD: резюме (поправил)' }, confirm: true, actor, version: opened.version })
    expect(res).toEqual({ ok: false, status: 409, error: 'Разбор обновился — откройте проверку заново' })
    expect(w.db.diagnostics[0]).toMatchObject({ ai_reviewed_at: null, ai_expert_edits: null })
  })

  it('regenerated between the server\'s read and its write → the UPDATE matches nothing (atomic) → 409', async () => {
    const w = slaDb({ diagnostics: [row({ ai_status: 'completed', ai_analysis: OLD })] })
    const opened = await loadAiReview(w.sb, CLIENT)
    // the regeneration lands right before the UPDATE runs
    const sb = {
      ...w.sb,
      from(table: string) {
        const q = (w.sb as unknown as { from: (t: string) => Record<string, unknown> }).from(table)
        if (table !== 'diagnostics') return q
        const update = q.update as (p: Row) => unknown
        return { ...q, update: (p: Row) => { regenerate(w.db.diagnostics[0]); return update.call(q, p) } }
      },
    } as unknown as SupabaseClient
    const res = await saveAiReview(sb, { clientId: CLIENT, diagnosticId: DIAG, edits: null, confirm: true, actor, version: opened.version })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(w.db.diagnostics[0].ai_reviewed_at).toBeNull()
  })

  it('the same version → confirmed; the route takes the version from the body', async () => {
    const w = slaDb({ diagnostics: [row({ ai_status: 'completed', ai_analysis: OLD })] })
    const opened = await loadAiReview(w.sb, CLIENT)
    const res = await saveAiReview(w.sb, { clientId: CLIENT, diagnosticId: DIAG, edits: null, confirm: true, actor, version: opened.version })
    expect(res).toMatchObject({ ok: true, confirmed: true })
    expect(w.db.diagnostics[0]).toMatchObject({ ai_reviewed_by_name: 'Пётр Эксперт' })
    expect(AiReviewBodySchema.safeParse({ diagnosticId: DIAG, version: opened.version }).success).toBe(true)
    expect(AiReviewBodySchema.safeParse({ diagnosticId: DIAG, version: 1 }).success).toBe(false)
  })
})
