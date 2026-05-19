// Unit tests for the metric resolver (Phase 1).
// Verifies: registry shape, source-adapter behavior, priority/confidence,
// document → metric_id binding fallback, provenance recording, summarize().

import { describe, expect, it, beforeEach } from 'vitest'
import {
  getMetricRegistry,
  getMetricById,
  getMetricsByNamespace,
  __resetRegistryCache,
  slugifyLabel,
} from '@/lib/metrics/registry'
import { resolveMetric, resolveAllMetrics, summarize } from '@/lib/metrics/resolver'
import {
  coerceNumeric,
  tryResolveSource,
  resolveSurveySource,
  resolveDocumentSource,
} from '@/lib/metrics/source-adapters'
import { toMaterializedRow } from '@/lib/metrics/materialize'
import type { ResolverContext, ResolverDocument } from '@/lib/metrics/types'
import type { MetricSource } from '@/lib/metrics/descriptions'

const FIXED_NOW = new Date('2026-05-19T12:00:00Z')

function makeCtx(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    companyId: 'co-1',
    userId: 'user-1',
    surveyAnswers: {},
    documents: [],
    now: FIXED_NOW,
    ...overrides,
  }
}

beforeEach(() => {
  __resetRegistryCache()
})

// ─── Registry ────────────────────────────────────────────────

describe('registry', () => {
  it('builds 100+ metric entries across 4 namespaces', () => {
    const reg = getMetricRegistry()
    expect(reg.length).toBeGreaterThanOrEqual(100)
    const namespaces = new Set(reg.map((e) => e.namespace))
    expect(namespaces).toEqual(new Set(['biz', 'kpi', 'gri', 'goal']))
  })

  it('produces stable ids with namespace prefix', () => {
    const reg = getMetricRegistry()
    for (const entry of reg) {
      expect(entry.id).toMatch(/^(biz|kpi|gri|goal)\./)
      expect(entry.id).toBe(entry.id.toLowerCase())
    }
  })

  it('all biz metrics have a department field', () => {
    const biz = getMetricsByNamespace('biz')
    expect(biz.length).toBeGreaterThan(0)
    for (const entry of biz) {
      expect(entry.department).toBeTruthy()
    }
  })

  it('all goal metrics carry a goalNumber', () => {
    const goals = getMetricsByNamespace('goal')
    expect(goals.length).toBeGreaterThan(0)
    for (const entry of goals) {
      expect(entry.goalNumber).toMatch(/^\d{2}$/)
    }
  })

  it('lookup by id round-trips', () => {
    const first = getMetricRegistry()[0]
    expect(getMetricById(first.id)?.label).toBe(first.label)
  })

  it('slugifyLabel transliterates cyrillic', () => {
    expect(slugifyLabel('Выручка (год)')).toMatch(/^vyruchka/)
    expect(slugifyLabel('LTV/CAC')).toBe('ltv_cac')
  })
})

// ─── coerceNumeric ───────────────────────────────────────────

describe('coerceNumeric', () => {
  it('handles numbers', () => {
    expect(coerceNumeric(42)).toBe(42)
    expect(coerceNumeric(NaN)).toBeNull()
  })

  it('parses formatted strings', () => {
    expect(coerceNumeric('84 200 000')).toBe(84200000)
    expect(coerceNumeric('34,2')).toBe(34.2)
    expect(coerceNumeric('₸ 1 250')).toBe(1250)
  })

  it('coerces booleans', () => {
    expect(coerceNumeric(true)).toBe(1)
    expect(coerceNumeric(false)).toBe(0)
  })

  it('returns null for non-numeric input', () => {
    expect(coerceNumeric('abc')).toBeNull()
    expect(coerceNumeric(null)).toBeNull()
    expect(coerceNumeric(undefined)).toBeNull()
  })
})

// ─── Survey adapter ──────────────────────────────────────────

describe('resolveSurveySource', () => {
  const src: MetricSource = { type: 'survey', step: 2, key: 's2_revenue_2024', label: 'Выручка' }

  it('hits when answer present', () => {
    const ctx = makeCtx({ surveyAnswers: { s2_revenue_2024: 84200000 } })
    const r = resolveSurveySource(src, ctx)
    expect(r.status).toBe('hit')
    expect(r.numeric).toBe(84200000)
    expect(r.confidence).toBe(0.9)
  })

  it('misses when answer empty', () => {
    const ctx = makeCtx({ surveyAnswers: { s2_revenue_2024: '' } })
    expect(resolveSurveySource(src, ctx).status).toBe('miss')
  })

  it('misses when key absent', () => {
    expect(resolveSurveySource(src, makeCtx()).status).toBe('miss')
  })

  it('refuses non-survey sources', () => {
    const wrong: MetricSource = { type: 'document', doc_type: 'pl_report', field: 'revenue' }
    expect(resolveSurveySource(wrong, makeCtx()).status).toBe('error')
  })
})

// ─── Document adapter ────────────────────────────────────────

describe('resolveDocumentSource', () => {
  const src: MetricSource = { type: 'document', doc_type: 'pl_report', field: 'revenue' }

  function doc(parsedData: ResolverDocument['parsedData']): ResolverDocument {
    return {
      id: 'd1',
      docType: 'pl_report',
      parsedData,
      periodYear: 2024,
      periodQuarter: null,
      uploadedAt: '2026-05-10T00:00:00Z',
    }
  }

  it('matches by explicit metric_id when present', () => {
    const ctx = makeCtx({
      documents: [doc({
        fields: [
          { key: 'other_field', value: 1 },
          { key: 'something', metric_id: 'biz.finansy.vyruchka_god', value: 84200000, confidence: 0.92 },
        ],
      })],
    })
    const r = resolveDocumentSource(src, ctx, 'biz.finansy.vyruchka_god')
    expect(r.status).toBe('hit')
    expect(r.numeric).toBe(84200000)
    expect(r.confidence).toBeCloseTo(0.92)
  })

  it('falls back to key match on source.field', () => {
    const ctx = makeCtx({
      documents: [doc({
        fields: [{ key: 'revenue', value: 80000000, confidence: 0.7 }],
      })],
    })
    const r = resolveDocumentSource(src, ctx, 'biz.finansy.vyruchka_god')
    expect(r.status).toBe('hit')
    expect(r.numeric).toBe(80000000)
  })

  it('misses when doc_type does not match', () => {
    const ctx = makeCtx({
      documents: [{
        ...doc({ fields: [{ key: 'revenue', value: 1 }] }),
        docType: 'balance_sheet',
      }],
    })
    expect(resolveDocumentSource(src, ctx, 'biz.x').status).toBe('miss')
  })

  it('prefers the document closest to preferred period', () => {
    const ctx = makeCtx({
      preferPeriodYear: 2024,
      documents: [
        { ...doc({ fields: [{ key: 'revenue', value: 99 }] }), id: 'old', periodYear: 2023, uploadedAt: '2026-05-12T00:00:00Z' },
        { ...doc({ fields: [{ key: 'revenue', value: 84200000 }] }), id: 'right', periodYear: 2024, uploadedAt: '2026-05-10T00:00:00Z' },
      ],
    })
    const r = resolveDocumentSource(src, ctx, 'biz.x')
    expect(r.numeric).toBe(84200000)
    expect(r.reason).toMatch(/right/)
  })
})

// ─── tryResolveSource dispatch ───────────────────────────────

describe('tryResolveSource', () => {
  it('dispatches by type', () => {
    const ctx = makeCtx({ surveyAnswers: { s2_revenue_2024: 1 } })
    const r = tryResolveSource({ type: 'survey', key: 's2_revenue_2024' }, ctx, 'm')
    expect(r.status).toBe('hit')
  })

  it('marks missing sources as miss with note', () => {
    const r = tryResolveSource({ type: 'missing', note: 'TBD' }, makeCtx(), 'm')
    expect(r.status).toBe('miss')
    expect(r.reason).toBe('TBD')
  })
})

// ─── Resolver priority + provenance ──────────────────────────

describe('resolveMetric', () => {
  it('returns unknown-id stub gracefully', () => {
    const r = resolveMetric('does.not.exist', makeCtx())
    expect(r.value).toBeNull()
    expect(r.confidence).toBe(0)
    expect(r.notes).toMatch(/unknown metric id/)
  })

  it('picks document over survey when both hit', () => {
    const entry = {
      id: 'test.metric',
      namespace: 'biz' as const,
      label: 'Test',
      unit: '₸',
      sources: [
        { type: 'survey', key: 's2_revenue_2024' } as MetricSource,
        { type: 'document', doc_type: 'pl_report', field: 'revenue' } as MetricSource,
      ],
    }
    const ctx = makeCtx({
      surveyAnswers: { s2_revenue_2024: 70000000 },
      documents: [{
        id: 'd1',
        docType: 'pl_report',
        parsedData: { fields: [{ key: 'revenue', value: 84200000, confidence: 0.9 }] },
        periodYear: 2024,
        periodQuarter: null,
        uploadedAt: '2026-05-10T00:00:00Z',
      }],
    })
    const r = resolveMetric('test.metric', ctx, { entry })
    expect(r.picked?.type).toBe('document')
    expect(r.numeric).toBe(84200000)
    expect(r.considered).toHaveLength(2)
  })

  it('picks manual override above everything', () => {
    const entry = {
      id: 'test.manual',
      namespace: 'biz' as const,
      label: 'Test',
      unit: '%',
      sources: [
        { type: 'survey', key: 's2_gross_margin' } as MetricSource,
        { type: 'manual' } as MetricSource,
      ],
    }
    const ctx = makeCtx({
      surveyAnswers: { s2_gross_margin: 30 },
      manualOverrides: { 'test.manual': 42 },
    })
    const r = resolveMetric('test.manual', ctx, { entry })
    expect(r.picked?.type).toBe('manual')
    expect(r.numeric).toBe(42)
    expect(r.confidence).toBeGreaterThan(0.9)
  })

  it('returns null with full provenance when every source misses', () => {
    const entry = {
      id: 'test.empty',
      namespace: 'biz' as const,
      label: 'Test',
      unit: '',
      sources: [
        { type: 'survey', key: 'never' } as MetricSource,
        { type: 'missing', note: 'wired later' } as MetricSource,
      ],
    }
    const r = resolveMetric('test.empty', makeCtx(), { entry })
    expect(r.picked).toBeNull()
    expect(r.value).toBeNull()
    expect(r.considered).toHaveLength(2)
    expect(r.notes).toBe('no source resolved')
  })

  it('records computedAt from injected clock', () => {
    const entry = {
      id: 'test.t',
      namespace: 'biz' as const,
      label: 'T',
      unit: '',
      sources: [{ type: 'survey', key: 'k' } as MetricSource],
    }
    const ctx = makeCtx({ surveyAnswers: { k: 1 } })
    const r = resolveMetric('test.t', ctx, { entry })
    expect(r.computedAt).toBe(FIXED_NOW.toISOString())
  })
})

// ─── Batch + summarize ───────────────────────────────────────

describe('resolveAllMetrics + summarize', () => {
  it('resolves the full catalog and reports coverage', () => {
    const ctx = makeCtx({
      surveyAnswers: {
        s2_revenue_2024: 84200000,
        s2_gross_margin: 34.2,
        s2_cac: 25000,
        s2_ltv: 80000,
        s3_has_crm: 'amocrm',
        s6_goal_12months: 'Удвоить выручку',
      },
    })
    const values = resolveAllMetrics(ctx)
    expect(values.length).toBeGreaterThan(100)
    const summary = summarize(values)
    expect(summary.total).toBe(values.length)
    expect(summary.resolved).toBeGreaterThan(0)
    expect(summary.coverage).toBeGreaterThan(0)
    expect(summary.coverage).toBeLessThan(1)
    expect(summary.topGaps.length).toBeGreaterThan(0)
  })

  it('returns zero coverage on empty context', () => {
    const summary = summarize(resolveAllMetrics(makeCtx()))
    expect(summary.resolved).toBe(0)
    expect(summary.coverage).toBe(0)
  })
})

// ─── Materialize row mapping ─────────────────────────────────

describe('toMaterializedRow', () => {
  it('maps picked source → row.source', () => {
    const entry = {
      id: 'test.r',
      namespace: 'biz' as const,
      label: 'R',
      unit: '₸',
      sources: [{ type: 'survey', key: 'r' } as MetricSource],
    }
    const ctx = makeCtx({ surveyAnswers: { r: 1000 } })
    const v = resolveMetric('test.r', ctx, { entry })
    const row = toMaterializedRow(v, 'co-1')
    expect(row.company_id).toBe('co-1')
    expect(row.metric_key).toBe('test.r')
    expect(row.metric_value).toBe(1000)
    expect(row.metric_unit).toBe('₸')
    expect(row.source).toBe('survey')
    expect(row.confidence).toBeGreaterThan(0)
    expect((row.provenance as { picked: unknown }).picked).toBeTruthy()
  })

  it('maps unresolved → null value + null confidence', () => {
    const entry = {
      id: 'test.unres',
      namespace: 'biz' as const,
      label: 'U',
      unit: '',
      sources: [{ type: 'survey', key: 'absent' } as MetricSource],
    }
    const v = resolveMetric('test.unres', makeCtx(), { entry })
    const row = toMaterializedRow(v, 'co-1')
    expect(row.metric_value).toBeNull()
    expect(row.confidence).toBeNull()
    expect(row.source).toBe('resolver')
  })
})
