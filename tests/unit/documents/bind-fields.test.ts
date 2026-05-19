/**
 * Tests for `lib/documents/bind-fields.ts` — the deterministic synonym binder.
 *
 * The deterministic path is fully synchronous (no network), so most cases
 * don't need any mocking. The AI-fallback case mocks the dynamically-imported
 * `bind-fields-ai` module via `vi.doMock`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ParsedDataField } from '@/lib/documents/extract'
import {
  __resetBindFieldsCache,
  bindFieldsToMetrics,
  resolveMetricIdForField,
} from '@/lib/documents/bind-fields'
import { __resetRegistryCache, getMetricById } from '@/lib/metrics/registry'

function field(overrides: Partial<ParsedDataField>): ParsedDataField {
  return {
    key: 'revenue',
    label: 'Revenue',
    value: 100,
    target_tab: 'Финансы',
    target_parameter: 'Выручка',
    source: undefined,
    confidence: 0.9,
    ...overrides,
  }
}

const originalKey = process.env.OPENROUTER_API_KEY

beforeEach(() => {
  __resetBindFieldsCache()
  __resetRegistryCache()
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
  vi.restoreAllMocks()
})

describe('resolveMetricIdForField — deterministic path', () => {
  it('binds field=revenue + doc_type=pl_report to the biz finance revenue metric', () => {
    const id = resolveMetricIdForField(
      field({ key: 'revenue', label: 'Revenue', value: 84_200_000 }),
      'pl_report'
    )
    expect(id).toBeTruthy()
    expect(id!.startsWith('biz.')).toBe(true)
    const entry = getMetricById(id!)
    // The matched metric must declare a document source whose field is revenue.
    expect(
      entry?.sources.some(
        (s) => s.type === 'document' && s.field === 'revenue' && s.doc_type === 'pl_report'
      )
    ).toBe(true)
    // And its label must resolve back to "revenue" via synonyms — i.e. the
    // generic top-line metric, not "Выручка с продажника".
    expect(entry?.label).toMatch(/выручка/i)
    expect(entry?.label).not.toMatch(/продажник/i)
  })

  it('binds via Russian label "Выручка" through the synonym dictionary', () => {
    const id = resolveMetricIdForField(
      field({ key: 'random_key', label: 'Выручка', value: 1_000_000 }),
      'pl_report'
    )
    expect(id).toBeTruthy()
    const entry = getMetricById(id!)
    expect(entry?.label).toMatch(/выручка/i)
  })

  it('binds via English snake_case key (gross_margin → %-unit metric)', () => {
    const id = resolveMetricIdForField(
      field({ key: 'gross_margin', label: 'Gross Margin', value: 42, target_parameter: 'Маржинальность' }),
      'pl_report'
    )
    expect(id).toBeTruthy()
    const entry = getMetricById(id!)
    expect(entry?.unit).toBe('%')
    expect(
      entry?.sources.some((s) => s.type === 'document' && s.field === 'gross_margin')
    ).toBe(true)
  })

  it('does not bind a revenue field uploaded under marketing_report doc_type', () => {
    // The registry's `revenue` sources are all on pl_report, so a strict
    // doc_type mismatch should return no candidate.
    const id = resolveMetricIdForField(
      field({ key: 'revenue', label: 'Revenue', value: 100 }),
      'marketing_report'
    )
    // We accept either null (strict) or a generic non-pl_report match. The
    // contract says "no bind (or generic fallback)" — when there is no
    // marketing_report source for `revenue`, the deterministic path must NOT
    // pick the pl_report metric.
    if (id) {
      const entry = getMetricById(id)
      const hasMarketingSource = entry?.sources.some(
        (s) => s.type === 'document' && s.field === 'revenue' && s.doc_type === 'marketing_report'
      )
      expect(hasMarketingSource).toBe(true)
    } else {
      expect(id).toBeNull()
    }
  })

  it('returns null for an unknown field key/label', () => {
    const id = resolveMetricIdForField(
      field({ key: 'frobnicator_xyz', label: 'абракадабра 42' }),
      'pl_report'
    )
    expect(id).toBeNull()
  })

  it('passes through fields that already carry a metric_id (idempotent)', () => {
    const pre: ParsedDataField & { metric_id: string } = {
      ...field({ key: 'whatever', label: 'whatever' }),
      metric_id: 'biz.finansy.vyruchka_god',
    }
    const id = resolveMetricIdForField(pre, 'pl_report')
    expect(id).toBe('biz.finansy.vyruchka_god')
  })

  it('matches case-insensitively (REVENUE works)', () => {
    const id = resolveMetricIdForField(
      field({ key: 'REVENUE', label: 'REVENUE' }),
      'pl_report'
    )
    expect(id).toBeTruthy()
    expect(getMetricById(id!)?.label).toMatch(/выручка/i)
  })

  it('falls back to literal field-key scan when synonyms miss', () => {
    // `unit_cost` is not in synonyms.ts but exists as a doc-source field on
    // a biz metric — the literal-scan branch must catch it.
    const id = resolveMetricIdForField(
      field({ key: 'unit_cost', label: 'Unit Cost', value: 1234 }),
      'ops_report'
    )
    expect(id).toBeTruthy()
    expect(
      getMetricById(id!)?.sources.some(
        (s) => s.type === 'document' && s.field === 'unit_cost'
      )
    ).toBe(true)
  })
})

describe('bindFieldsToMetrics — batch + stats', () => {
  it('returns empty result for an empty fields array', async () => {
    const out = await bindFieldsToMetrics([], 'pl_report')
    expect(out.fields).toEqual([])
    expect(out.stats).toEqual({ total: 0, deterministicHits: 0, aiHits: 0, unbound: 0 })
  })

  it('counts deterministicHits / aiHits / unbound correctly in stats', async () => {
    const fields = [
      field({ key: 'revenue', label: 'Revenue' }),
      field({ key: 'gross_margin', label: 'Gross Margin', value: 42 }),
      field({ key: 'frobnicator_xyz', label: 'абракадабра 42', value: 'lol' }),
    ]
    const out = await bindFieldsToMetrics(fields, 'pl_report')
    expect(out.stats.total).toBe(3)
    expect(out.stats.deterministicHits).toBe(2)
    expect(out.stats.aiHits).toBe(0)
    expect(out.stats.unbound).toBe(1)

    // Input must not be mutated.
    expect((fields[0] as ParsedDataField & { metric_id?: string }).metric_id).toBeUndefined()

    // First two fields got a metric_id, third stays null.
    expect(
      (out.fields[0] as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBeTruthy()
    expect(
      (out.fields[1] as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBeTruthy()
    expect(
      (out.fields[2] as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBeNull()
  })

  it('with useAI=true but no OpenRouter key, falls back to deterministic only', async () => {
    delete process.env.OPENROUTER_API_KEY
    const fields = [
      field({ key: 'revenue', label: 'Revenue' }),
      field({ key: 'mystery_metric', label: 'некая метрика', value: 7, confidence: 0.95 }),
    ]
    const out = await bindFieldsToMetrics(fields, 'pl_report', { useAI: true })
    expect(out.stats.aiHits).toBe(0)
    expect(out.stats.deterministicHits).toBe(1)
    expect(out.stats.unbound).toBe(1)
    // No throw, no error log we care about.
  })
})
