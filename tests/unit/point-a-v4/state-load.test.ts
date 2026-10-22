/**
 * The Point A page state (lib/point-a/v4/state.ts) — what it reads and how many round trips it waits
 * for (W4): every company-keyed read starts with the company row, the GRI / questionnaire / block
 * config follow the company row only, the key metrics follow the config only.
 * In-memory DB, no network.
 */
import { describe, expect, it, vi } from 'vitest'
import { loadPointAState } from '@/lib/point-a/v4/state'
import { DEFAULT_KEY_METRICS } from '@/lib/point-a/v4/metric-views'
import { memoryDb, roundTrips } from '../_round-trips'

const OWNER = 'cccccccc-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const REVENUE = 'biz.finansy.vyruchka_god'

const tables = () => ({
  companies: [{ id: COMPANY, user_id: OWNER, industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }],
  point_a_snapshots: [
    { id: 'snap-2', company_id: COMPANY, created_at: '2026-10-10T00:00:00Z', engine: 'v4', trigger: 'event', overall: 61, confidence: 0.7, coverage: 0.8, stage: 'growth', blocks: [{ key: 'finance', score: 60 }], change_reasons: [{ text: 'Новая выручка' }], inputs: {}, v4: {}, reviewed_at: null, reviewed_by: null, reviewed_by_name: null },
    { id: 'snap-1', company_id: COMPANY, created_at: '2026-10-01T00:00:00Z', engine: 'v4', trigger: 'event', overall: 55, confidence: 0.6, coverage: 0.7, stage: 'growth', blocks: [], change_reasons: [], inputs: {}, v4: {}, reviewed_at: '2026-10-02T00:00:00Z', reviewed_by: 'e', reviewed_by_name: 'Алия' },
  ],
  data_discrepancies: [],
  gri_assessments: [{ company_id: COMPANY, user_id: OWNER, is_current: true, gri_index: 6.4, created_at: '2026-09-01T00:00:00Z' }],
  documents: [{ company_id: COMPANY, parse_status: 'parsed' }, { company_id: COMPANY, parse_status: 'queued' }],
  metrics: [{ company_id: COMPANY, metric_key: REVENUE, metric_value: 60_000_000, metric_unit: 'KZT', source: 'survey', confidence: 0.8, period_year: 2026, computed_at: '2026-10-01T00:00:00Z' }],
  point_a_recalc_queue: [],
  point_a_comments: [],
  survey_answers: [{ user_id: OWNER, question_key: 's1_company_name', step: 1, answer: { value: 'Ромашка' } }],
  metric_targets: [{ id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better', source: 'owner', created_at: '2026-04-18T09:00:00Z' }],
  pa_templates: [],
  pa_company_config: [],
  metric_value_history: [],
})

describe('loadPointAState (W4)', () => {
  it('reads the page in three round trips and keeps every part of it', async () => {
    const net = roundTrips(memoryDb(tables()))
    const state = await loadPointAState(net.sb, net.sb, COMPANY)
    // company + every company-keyed read → GRI / questionnaire / config (+ the goals' metrics) → key metrics
    expect(net.waves()).toBeLessThanOrEqual(3)
    expect(net.reads.companies).toBe(2) // the company row + the goals' revenue targets

    expect(state.snapshot?.id).toBe('snap-2')
    expect(state.history.map((h) => h.id)).toEqual(['snap-2', 'snap-1'])
    expect(state.review).toEqual({ status: 'earlier', by: 'Алия', at: '2026-10-02T00:00:00Z' })
    expect(state.gri).toEqual({ index100: 64, assessedAt: '2026-09-01T00:00:00Z' })
    expect(state.sources.documents).toEqual({ parsed: 1, processing: 1, failed: 0 })
    expect(state.sources.metrics).toBe(1)
    expect(state.sources.survey.completed).toBeGreaterThanOrEqual(0)
    expect(state.goals.map((g) => g.goal.metricId)).toEqual([REVENUE])
    expect(state.keyMetrics.map((m) => m.id)).toEqual([...DEFAULT_KEY_METRICS].slice(0, state.keyMetrics.length))
    expect(state.keyMetricsCustom).toBe(false)
    expect(state.recalculation).toBe('idle')
    expect(state.config.blocks.length).toBeGreaterThan(0)
  })

  it('a company the owner chose key metrics for: the strip follows the config', async () => {
    const t = tables()
    ;(t.pa_company_config as unknown[]).push({ company_id: COMPANY, template_key: null, expert_overrides: {}, client_view: { keyMetrics: [REVENUE] }, version: 1 })
    const state = await loadPointAState(memoryDb(t), memoryDb(t), COMPANY)
    expect(state.keyMetricsCustom).toBe(true)
    expect(state.keyMetrics.map((m) => m.id)).toEqual([REVENUE])
  })

  it('a failed company or snapshot read fails the page; a failed goals or key-metrics read does not', async () => {
    const boom = { code: 'XX000', message: 'boom' }
    await expect(loadPointAState(roundTrips(memoryDb(tables()), { fail: { companies: boom } }).sb, memoryDb(tables()), COMPANY)).rejects.toThrow(/company read failed/)
    await expect(loadPointAState(roundTrips(memoryDb(tables()), { fail: { point_a_snapshots: boom } }).sb, memoryDb(tables()), COMPANY)).rejects.toThrow(/read failed/)

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const state = await loadPointAState(roundTrips(memoryDb(tables()), { fail: { metric_targets: boom, metric_value_history: boom } }).sb, memoryDb(tables()), COMPANY)
      expect(state.goals).toEqual([])
      expect(state.snapshot?.id).toBe('snap-2')
    } finally {
      err.mockRestore()
    }
  })

  it('a company without an owner reads no questionnaire', async () => {
    const t = tables()
    t.companies[0].user_id = null as unknown as string
    const net = roundTrips(memoryDb(t))
    const state = await loadPointAState(net.sb, net.sb, COMPANY)
    expect(net.reads.survey_answers ?? 0).toBe(0)
    expect(state.sources.survey.completed).toBe(0)
  })
})
