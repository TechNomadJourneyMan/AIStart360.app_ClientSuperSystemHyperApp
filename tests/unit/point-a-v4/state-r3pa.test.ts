/**
 * R3-PA — the Point A page state (lib/point-a/v4/state.ts) carries what the
 * paid client needs, still in ≤ 3 round trips:
 *   • aiAnalysis — the AI analysis of the owner's current diagnostic (a draft
 *     until reviewed); none without an official score; before migration 150
 *     read without the review columns;
 *   • scorePath — «Минимум для Точки А» = the rule of the score on the
 *     current answers;
 *   • documents stuck «в очереди» since April are «не обработаны», not «в работе»;
 *   • GRI on 0–10; the industry comparison marked «не проверено экспертом».
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPointAState } from '@/lib/point-a/v4/state'
import { memoryDb, roundTrips } from '../_round-trips'

const OWNER = 'cccccccc-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const AI = { executive_summary: 'Бизнес растёт', strategic_priorities: [{ title: 'П1', rationale: 'r', expected_impact: 'e' }], growth_roadmap: [], blocks: {}, industry_context: 'к', model_used: 'm', generated_at: '2026-11-15T10:00:00Z' }

const tables = (over: { snapshot?: Record<string, unknown>; diag?: Record<string, unknown> | null; docs?: Array<Record<string, unknown>> } = {}) => ({
  companies: [{ id: COMPANY, user_id: OWNER, industry: 'Интернет-магазин' }],
  point_a_snapshots: [{
    id: 'snap-1', company_id: COMPANY, created_at: '2026-11-10T00:00:00Z', engine: 'v4', trigger: 'event', overall: 61, confidence: 0.7, coverage: 0.8, stage: 'growth',
    blocks: [{ key: 'finance', score: 60 }], change_reasons: [], inputs: {}, v4: { assessment: 'full' }, reviewed_at: null, reviewed_by: null, reviewed_by_name: null,
    ...(over.snapshot ?? {}),
  }],
  diagnostics: over.diag === null ? [] : [{ id: 'diag-1', user_id: OWNER, is_current: true, ai_status: 'completed', ai_analysis: AI, ai_error: null, ai_model: 'anthropic/claude-haiku-4.5 + qwen3-8', ai_generated_at: '2026-11-15T10:00:40Z', ai_reviewed_at: null, ai_reviewed_by_name: null, ai_expert_edits: null, ...(over.diag ?? {}) }],
  data_discrepancies: [],
  gri_assessments: [{ company_id: COMPANY, user_id: OWNER, is_current: true, gri_index: 5.8, created_at: '2026-09-01T00:00:00Z' }],
  documents: over.docs ?? [
    { company_id: COMPANY, parse_status: 'queued', uploaded_at: '2026-04-10T08:00:00Z', updated_at: '2026-04-10T08:00:00Z' },
    { company_id: COMPANY, parse_status: 'processing', uploaded_at: new Date(Date.now() - 5 * 60_000).toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString() },
    { company_id: COMPANY, parse_status: 'parsed', uploaded_at: '2026-04-10T08:00:00Z' },
  ],
  metrics: [],
  point_a_recalc_queue: [],
  point_a_comments: [],
  survey_answers: [{ user_id: OWNER, question_key: 's4_has_org_chart', step: 4, answer: { value: true } }],
  metric_targets: [],
  pa_templates: [],
  pa_company_config: [],
  metric_value_history: [],
})

describe('loadPointAState — R3-PA fields', () => {
  it('still ≤ 3 round trips with the AI analysis and the score path', async () => {
    const net = roundTrips(memoryDb(tables()))
    const state = await loadPointAState(net.sb, net.sb, COMPANY, OWNER)
    expect(net.waves()).toBeLessThanOrEqual(3)
    expect(state.aiAnalysis).toMatchObject({ diagnosticId: 'diag-1', status: 'completed', draft: true, model: 'anthropic/claude-haiku-4.5 + qwen3-8' })
    expect(state.aiAnalysis?.analysis?.executive_summary).toBe('Бизнес растёт')
    expect(state.scorePath).not.toBeNull()
  })

  it('GRI is 0–10 (5.8, not 58); the industry comparison is marked as not approved by an expert', async () => {
    const state = await loadPointAState(memoryDb(tables()), memoryDb(tables()), COMPANY)
    expect(state.gri).toEqual({ index: 5.8, assessedAt: '2026-09-01T00:00:00Z' })
    if (state.benchmarks) expect(state.benchmarks.approved).toBe(false)
  })

  it('a document «в очереди» since April is «не обработан» (stale), a fresh one is «в работе»', async () => {
    const state = await loadPointAState(memoryDb(tables()), memoryDb(tables()), COMPANY)
    expect(state.sources.documents).toEqual({ parsed: 1, processing: 1, failed: 0, stale: 1 })
  })

  it('no official score (preliminary snapshot) → no AI analysis on the page; the path says what is left', async () => {
    const t = tables({ snapshot: { v4: { assessment: 'preliminary' }, overall: null } })
    const state = await loadPointAState(memoryDb(t), memoryDb(t), COMPANY)
    expect(state.aiAnalysis).toBeNull()
    expect(state.scorePath).toMatchObject({ surveySent: false })
    expect(state.scorePath!.dataEnough).toBe(false)
    expect(state.scorePath!.toFill.length).toBeGreaterThan(0)
    expect(state.scorePath!.toFill.some((b) => b.required)).toBe(true)
  })

  it('reviewed by an expert → «Проверено экспертом», the expert\'s text over the AI', async () => {
    const t = tables({ diag: { ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by_name: 'Алия', ai_expert_edits: { executive_summary: 'Текст эксперта' } } })
    const state = await loadPointAState(memoryDb(t), memoryDb(t), COMPANY)
    expect(state.aiAnalysis).toMatchObject({ draft: false, review: { by: 'Алия', at: '2026-11-16T09:00:00Z' }, editedByExpert: ['executive_summary'] })
    expect(state.aiAnalysis?.analysis?.executive_summary).toBe('Текст эксперта')
  })

  it('before migration 150 the AI analysis is read without the new columns (still a draft)', async () => {
    const db = memoryDb(tables())
    const pre150 = {
      ...db,
      from(table: string) {
        const q = (db as unknown as { from: (t: string) => Record<string, unknown> }).from(table)
        if (table !== 'diagnostics') return q
        const select = q.select as (c?: string) => unknown
        return { ...q, select: (cols?: string) => (cols?.includes('ai_error')
          ? { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column diagnostics.ai_error does not exist' } }) }) }) }
          : select.call(q, cols)) }
      },
    } as unknown as SupabaseClient
    const state = await loadPointAState(pre150, memoryDb(tables()), COMPANY)
    expect(state.aiAnalysis).toMatchObject({ status: 'completed', draft: true })
  })

  it('a failed AI read hides the block, not the page', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const state = await loadPointAState(roundTrips(memoryDb(tables()), { fail: { diagnostics: { code: 'XX000', message: 'boom' } } }).sb, memoryDb(tables()), COMPANY)
      expect(state.aiAnalysis).toBeNull()
      expect(state.snapshot?.id).toBe('snap-1')
    } finally {
      err.mockRestore()
    }
  })
})
