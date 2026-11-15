/**
 * Ревью R3-PA — the Point A page state:
 *   H1  a lost «готовится» (> 15 min) is shown as failed («Повторить») AND the
 *       row is turned failed / 'stale' by this read (service role, only then);
 *   L5  «анкета отправлена» for «Минимум для Точки А» comes from
 *       survey_completed_at (090), not from the snapshot — after sending with a
 *       failed recalculation the card no longer asks to send again.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPointAState } from '@/lib/point-a/v4/state'
import { memoryDb } from '../_round-trips'

const OWNER = 'cccccccc-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const minAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const tables = (diag: Record<string, unknown>, snapshotV4: Record<string, unknown> = { assessment: 'full' }, overall: number | null = 61) => ({
  companies: [{ id: COMPANY, user_id: OWNER, industry: 'Интернет-магазин' }],
  point_a_snapshots: [{ id: 'snap-1', company_id: COMPANY, created_at: minAgo(60), engine: 'v4', trigger: 'event', overall, confidence: 0.7, coverage: 0.8, stage: 'growth', blocks: [{ key: 'finance', score: 60 }], change_reasons: [], inputs: {}, v4: snapshotV4, reviewed_at: null, reviewed_by: null, reviewed_by_name: null }],
  diagnostics: [{ id: 'diag-1', user_id: OWNER, is_current: true, calculated_at: minAgo(60), ai_analysis: null, ...diag }],
  data_discrepancies: [], gri_assessments: [], documents: [], metrics: [], point_a_recalc_queue: [], point_a_comments: [],
  survey_answers: [{ user_id: OWNER, question_key: 's4_has_org_chart', step: 4, answer: { value: true } }],
  metric_targets: [], pa_templates: [], pa_company_config: [], metric_value_history: [],
})

/** The service client: memory reads, a recorded diagnostics update, survey_completed_at by rpc. */
function service(t: ReturnType<typeof tables>, surveyCompletedAt: string | null | 'error' = null) {
  const db = memoryDb(t)
  const updates: Array<{ payload: Record<string, unknown>; filters: string[] }> = []
  const client = {
    from(table: string) {
      if (table !== 'diagnostics') return (db as unknown as { from: (t: string) => unknown }).from(table)
      const rec = { payload: {} as Record<string, unknown>, filters: [] as string[] }
      const b: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => { rec.payload = p; return b },
        eq: (c: string, v: unknown) => { rec.filters.push(`${c}=${String(v)}`); return b },
        or: (e: string) => { rec.filters.push(`or:${e}`); return b },
        select: () => b,
        then: (res: (v: unknown) => unknown) => { updates.push(rec); return Promise.resolve({ data: [{ id: 'diag-1' }], error: null }).then(res) },
      }
      return b
    },
    rpc: async (fn: string) => (fn === 'survey_completed_at'
      ? surveyCompletedAt === 'error' ? { data: null, error: { code: 'PGRST202' } } : { data: surveyCompletedAt, error: null }
      : { data: null, error: null }),
  }
  return { sb: client as unknown as SupabaseClient, updates }
}

describe('loadPointAState — ревью R3-PA', () => {
  it('H1: «готовится» for 20 min → failed / stale on the page, and the row is failed by this read', async () => {
    const t = tables({ ai_status: 'processing', ai_started_at: minAgo(20) })
    const s = service(t)
    const state = await loadPointAState(memoryDb(t), s.sb, COMPANY, OWNER)
    expect(state.aiAnalysis).toMatchObject({ status: 'failed', errorCode: 'stale' })
    expect(s.updates).toHaveLength(1)
    expect(s.updates[0].payload).toEqual({ ai_status: 'failed', ai_error: 'stale' })
    expect(s.updates[0].filters).toEqual(expect.arrayContaining(['ai_status=processing', 'id=diag-1']))
  })

  it('H1: a fresh «готовится» is left alone (no write)', async () => {
    const t = tables({ ai_status: 'processing', ai_started_at: minAgo(2) })
    const s = service(t)
    const state = await loadPointAState(memoryDb(t), s.sb, COMPANY, OWNER)
    expect(state.aiAnalysis).toMatchObject({ status: 'processing' })
    expect(s.updates).toHaveLength(0)
  })

  it('L5: the survey was sent (marker) but the snapshot is still preliminary → the card does not ask to send again', async () => {
    const t = tables({ ai_status: 'none' }, { assessment: 'preliminary' }, null)
    const sent = await loadPointAState(memoryDb(t), service(t, '2026-11-15T09:00:00Z').sb, COMPANY, OWNER)
    expect(sent.scorePath?.surveySent).toBe(true)
    const notSent = await loadPointAState(memoryDb(t), service(t, null).sb, COMPANY, OWNER)
    expect(notSent.scorePath?.surveySent).toBe(false)
    // before migration 090 (no function): the snapshot decides, as before
    const fallback = await loadPointAState(memoryDb(t), service(t, 'error').sb, COMPANY, OWNER)
    expect(fallback.scorePath?.surveySent).toBe(false)
  })
})
