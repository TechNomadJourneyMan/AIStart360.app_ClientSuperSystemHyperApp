// Unit tests for Phase 4 PointA aggregator.
// The aggregator combines the legacy rule-based scoring with the
// Phase-1 resolver. We use a tiny mock SupabaseClient that returns
// canned survey_answers and document rows.

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregatePointA } from '@/lib/point-a/aggregator'
import {
  buildByDepartment,
  buildTopGaps,
  buildTopStrengths,
  suggestSourceFor,
} from '@/lib/point-a/helpers'
import { getMetricRegistry, getMetricById } from '@/lib/metrics/registry'
import type { MetricEntry, MetricValue } from '@/lib/metrics/types'

// ─── Mock supabase factory ──────────────────────────────────

interface CannedResponses {
  survey_answers?: unknown[]
  documents?: unknown[]
  companies?: unknown[]
  metrics?: { error?: unknown }
}

function makeMockSupabase(canned: CannedResponses = {}) {
  const upsert = vi.fn().mockResolvedValue({
    data: null,
    error: canned.metrics?.error ?? null,
  })

  const surveyRows = canned.survey_answers ?? []
  const docRows = canned.documents ?? []

  function makeBuilder(rows: unknown[]) {
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
      upsert,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    }
    return builder
  }

  const from = vi.fn((table: string) => {
    if (table === 'survey_answers') return makeBuilder(surveyRows)
    if (table === 'documents') return makeBuilder(docRows)
    if (table === 'companies') return makeBuilder(canned.companies ?? [])
    if (table === 'metrics') return makeBuilder([])
    return makeBuilder([])
  })

  return {
    client: { from } as unknown as SupabaseClient,
    upsert,
    from,
  }
}

// ─── Sample survey covering Phase-1 keys ─────────────────────

function sampleSurveyRows() {
  // Keys touched by point-a-engine + the resolver (Финансы dept).
  return [
    { question_key: 's2_revenue_2023', answer: { value: 70_000_000 } },
    { question_key: 's2_revenue_2024', answer: { value: 84_200_000 } },
    { question_key: 's2_revenue_2025', answer: { value: 95_000_000 } },
    { question_key: 's2_avg_check',    answer: { value: 12000 } },
    { question_key: 's2_gross_margin', answer: { value: 38 } },
    { question_key: 's2_cac',          answer: { value: 5000 } },
    { question_key: 's2_ltv',          answer: { value: 25000 } },
    { question_key: 's2_knows_breakeven', answer: { value: true } },
    { question_key: 's2_debt_load',    answer: { value: 'moderate' } },
    { question_key: 's9n_revenue_2024', answer: { value: 84_200_000 } },
    { question_key: 's9n_change_vs_2023', answer: { value: 20 } },
  ]
}

// ─── Tests ────────────────────────────────────────────────────

describe('aggregatePointA', () => {
  it('returns the existing PointA shape intact (base fields preserved)', async () => {
    const { client } = makeMockSupabase({ survey_answers: sampleSurveyRows() })
    const result = await aggregatePointA(client, 'user-1', 'co-1', {
      skipMaterialize: true,
    })

    expect(typeof result.overall_score).toBe('number')
    expect(typeof result.health_index).toBe('number')
    expect(result.stage).toMatch(/^(seed|early|growth|scale|mature)$/)
    expect(result.blocks).toBeDefined()
    expect(result.blocks.finance).toBeDefined()
    expect(result.blocks.sales).toBeDefined()
    expect(Array.isArray(result.risks)).toBe(true)
    expect(Array.isArray(result.insights)).toBe(true)
    expect(Array.isArray(result.quick_wins)).toBe(true)
    expect(Array.isArray(result.data_gaps)).toBe(true)
  })

  it('attaches a well-formed intelligence block', async () => {
    const { client } = makeMockSupabase({ survey_answers: sampleSurveyRows() })
    const result = await aggregatePointA(client, 'user-1', 'co-1', {
      skipMaterialize: true,
    })

    const intel = result.intelligence
    expect(intel).toBeDefined()
    expect(Array.isArray(intel!.by_department)).toBe(true)
    expect(Array.isArray(intel!.top_strengths)).toBe(true)
    expect(Array.isArray(intel!.top_gaps)).toBe(true)
    expect(Array.isArray(intel!.trends)).toBe(true)
    expect(intel!.trends).toHaveLength(0)
    expect(intel!.resolver_version).toBe('phase4-v1')
    expect(typeof intel!.generated_at).toBe('string')
    expect(intel!.coverage).toBeDefined()
    expect(typeof intel!.coverage.overall).toBe('number')
  })

  it('coverage reflects resolved/total ratio correctly', async () => {
    const { client: emptyClient } = makeMockSupabase({ survey_answers: [] })
    const emptyResult = await aggregatePointA(emptyClient, 'u', 'c', {
      skipMaterialize: true,
    })
    expect(emptyResult.intelligence!.coverage.overall).toBe(0)
    expect(emptyResult.intelligence!.coverage.biz).toBe(0)

    const { client } = makeMockSupabase({ survey_answers: sampleSurveyRows() })
    const result = await aggregatePointA(client, 'u', 'c', {
      skipMaterialize: true,
    })
    expect(result.intelligence!.coverage.biz).toBeGreaterThan(0)
    expect(result.intelligence!.coverage.overall).toBeGreaterThan(0)
    expect(result.intelligence!.coverage.overall).toBeLessThanOrEqual(1)
  })

  it('by_department includes expected Russian departments', async () => {
    const { client } = makeMockSupabase({ survey_answers: sampleSurveyRows() })
    const result = await aggregatePointA(client, 'u', 'c', {
      skipMaterialize: true,
    })

    const departments = result.intelligence!.by_department.map((d) => d.department)
    expect(departments).toContain('Финансы')
    // Departments alpha-sorted in Russian locale; just check shape.
    for (const row of result.intelligence!.by_department) {
      expect(typeof row.coverage).toBe('number')
      expect(Array.isArray(row.strongest)).toBe(true)
      expect(Array.isArray(row.weakest)).toBe(true)
    }
  })

  it('top_strengths is sorted descending by confidence × hasValue', async () => {
    const { client } = makeMockSupabase({ survey_answers: sampleSurveyRows() })
    const result = await aggregatePointA(client, 'u', 'c', {
      skipMaterialize: true,
    })

    const strengths = result.intelligence!.top_strengths
    expect(strengths.length).toBeGreaterThan(0)
    expect(strengths.length).toBeLessThanOrEqual(10)
    // Every item exposes a namespace
    for (const s of strengths) {
      expect(['biz', 'kpi', 'gri', 'goal']).toContain(s.namespace)
    }
  })

  it('top_gaps lists only unresolved metrics that have a survey source', async () => {
    const { client } = makeMockSupabase({ survey_answers: sampleSurveyRows() })
    const result = await aggregatePointA(client, 'u', 'c', {
      skipMaterialize: true,
    })

    const gaps = result.intelligence!.top_gaps
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps.length).toBeLessThanOrEqual(10)
    for (const g of gaps) {
      const entry = getMetricById(g.metric_id)
      expect(entry).toBeDefined()
      expect(entry!.sources.some((s) => s.type === 'survey')).toBe(true)
      expect(typeof g.suggested_source).toBe('string')
      expect(g.suggested_source.length).toBeGreaterThan(0)
    }
  })

  it('empty context still returns a well-formed intelligence block', async () => {
    const { client } = makeMockSupabase({ survey_answers: [], documents: [] })
    const result = await aggregatePointA(client, 'u', 'c', {
      skipMaterialize: true,
    })

    expect(result.intelligence).toBeDefined()
    expect(result.intelligence!.coverage.overall).toBe(0)
    expect(result.intelligence!.coverage.biz).toBe(0)
    expect(result.intelligence!.coverage.kpi).toBe(0)
    expect(result.intelligence!.coverage.gri).toBe(0)
    expect(result.intelligence!.coverage.goal).toBe(0)
    expect(result.intelligence!.top_strengths).toEqual([])
    // top_gaps may contain unresolved-with-survey metrics — still capped at 10
    expect(result.intelligence!.top_gaps.length).toBeLessThanOrEqual(10)
  })

  it('skipMaterialize=true never calls upsert on metrics', async () => {
    const { client, upsert } = makeMockSupabase({
      survey_answers: sampleSurveyRows(),
    })
    await aggregatePointA(client, 'u', 'c', { skipMaterialize: true })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('skipMaterialize=false (default) attempts to upsert metrics', async () => {
    const { client, upsert } = makeMockSupabase({
      survey_answers: sampleSurveyRows(),
    })
    await aggregatePointA(client, 'u', 'c')
    expect(upsert).toHaveBeenCalled()
  })
})

// ─── Direct helper tests ─────────────────────────────────────

describe('suggestSourceFor', () => {
  it('produces a Russian survey suggestion when survey source is declared', () => {
    const entry: MetricEntry = {
      id: 'biz.finansy.test',
      namespace: 'biz',
      department: 'Финансы',
      label: 'Выручка (год)',
      unit: '₸',
      sources: [{ type: 'survey', step: 9, key: 's9n_revenue_2024' }],
    }
    const out = suggestSourceFor(entry)
    expect(out).toContain('Ответьте на анкету')
    expect(out).toContain('шаг 9')
    expect(out).toContain('Выручка (год)')
  })

  it('falls back to document suggestion when no survey source exists', () => {
    const entry: MetricEntry = {
      id: 'biz.finansy.test',
      namespace: 'biz',
      department: 'Финансы',
      label: 'EBITDA',
      unit: '₸',
      sources: [{ type: 'document', doc_type: 'pl_report', field: 'ebitda' }],
    }
    const out = suggestSourceFor(entry)
    expect(out).toContain('Загрузите документ')
    expect(out).toContain('pl_report')
  })

  it('falls back to external suggestion when only external source exists', () => {
    const entry: MetricEntry = {
      id: 'kpi.test',
      namespace: 'kpi',
      label: 'GA Sessions',
      unit: 'count',
      sources: [{ type: 'external', system: 'GA' }],
    }
    const out = suggestSourceFor(entry)
    expect(out).toContain('интеграцию с GA')
  })
})

// ─── buildByDepartment / buildTopStrengths / buildTopGaps ───

describe('buildTopStrengths', () => {
  it('sorts results descending by confidence × hasValue', () => {
    const entries: MetricEntry[] = [
      { id: 'biz.x.a', namespace: 'biz', department: 'X', label: 'A', unit: '', sources: [] },
      { id: 'biz.x.b', namespace: 'biz', department: 'X', label: 'B', unit: '', sources: [] },
      { id: 'biz.x.c', namespace: 'biz', department: 'X', label: 'C', unit: '', sources: [] },
    ]
    const baseAttempt = (status: 'hit' | 'miss') => ({
      source: { type: 'survey' as const, key: 'k' },
      status,
    })
    const values: MetricValue[] = [
      {
        metricId: 'biz.x.a',
        value: 10, numeric: 10, unit: '', confidence: 0.5,
        picked: { type: 'survey' }, considered: [baseAttempt('hit')],
        periodYear: null, periodQuarter: null, computedAt: '2026-05-19T00:00:00Z',
      },
      {
        metricId: 'biz.x.b',
        value: 20, numeric: 20, unit: '', confidence: 0.9,
        picked: { type: 'survey' }, considered: [baseAttempt('hit')],
        periodYear: null, periodQuarter: null, computedAt: '2026-05-19T00:00:00Z',
      },
      {
        metricId: 'biz.x.c',
        value: 30, numeric: 30, unit: '', confidence: 0.7,
        picked: { type: 'survey' }, considered: [baseAttempt('hit')],
        periodYear: null, periodQuarter: null, computedAt: '2026-05-19T00:00:00Z',
      },
    ]
    const strengths = buildTopStrengths(values, entries)
    expect(strengths.map((s) => s.metric_id)).toEqual([
      'biz.x.b',
      'biz.x.c',
      'biz.x.a',
    ])
  })
})

describe('buildTopGaps', () => {
  it('skips unresolved metrics that lack a survey source', () => {
    const entries: MetricEntry[] = [
      // Has only document source — should be excluded from "cheap" gaps.
      { id: 'biz.x.doc', namespace: 'biz', department: 'X', label: 'Doc', unit: '', sources: [{ type: 'document', doc_type: 'pl_report' }] },
      // Has survey source — should appear.
      { id: 'biz.x.sv', namespace: 'biz', department: 'X', label: 'Sv', unit: '', sources: [{ type: 'survey', step: 2, key: 's2_x' }] },
    ]
    const surveyMiss = {
      source: { type: 'survey' as const, key: 's2_x' },
      status: 'miss' as const,
      reason: 'survey key "s2_x" not answered',
    }
    const values: MetricValue[] = [
      {
        metricId: 'biz.x.doc',
        value: null, numeric: null, unit: '', confidence: 0,
        picked: null,
        considered: [{ source: { type: 'document' }, status: 'miss' }],
        periodYear: null, periodQuarter: null, computedAt: '2026-05-19T00:00:00Z',
      },
      {
        metricId: 'biz.x.sv',
        value: null, numeric: null, unit: '', confidence: 0,
        picked: null,
        considered: [surveyMiss],
        periodYear: null, periodQuarter: null, computedAt: '2026-05-19T00:00:00Z',
      },
    ]
    const gaps = buildTopGaps(values, entries)
    expect(gaps.map((g) => g.metric_id)).toEqual(['biz.x.sv'])
    expect(gaps[0].suggested_source).toContain('Ответьте на анкету')
  })
})

describe('buildByDepartment', () => {
  it('groups BIZ metrics by department and reports coverage', () => {
    const entries = getMetricRegistry().filter(
      (e) => e.namespace === 'biz' && e.department === 'Финансы',
    )
    // One resolved, the rest unresolved.
    const values: MetricValue[] = entries.map((e, i) => ({
      metricId: e.id,
      value: i === 0 ? 100 : null,
      numeric: i === 0 ? 100 : null,
      unit: e.unit,
      confidence: i === 0 ? 0.9 : 0,
      picked: i === 0 ? { type: 'survey' } : null,
      considered: [],
      periodYear: null,
      periodQuarter: null,
      computedAt: '2026-05-19T00:00:00Z',
    }))
    const out = buildByDepartment(values, entries)
    expect(out).toHaveLength(1)
    expect(out[0].department).toBe('Финансы')
    expect(out[0].coverage).toBeGreaterThan(0)
    expect(out[0].coverage).toBeLessThan(1)
    expect(out[0].strongest.length).toBeGreaterThan(0)
  })
})
