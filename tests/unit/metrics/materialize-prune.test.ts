/**
 * Materialisation removes rows the resolver wrote earlier from a source the
 * metric no longer declares (e.g. «CAC = весь маркетинговый бюджет» from
 * s9n_expense_marketing) — they were the latest value forever, because an
 * unresolved metric is skipped and the write is upsert-only.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { materializeAll, sourceIdentity, staleMetricRowIds } from '@/lib/metrics/materialize'
import { getMetricById } from '@/lib/metrics/registry'
import type { ResolverContext } from '@/lib/metrics/types'

const CAC_BUDGET = { type: 'survey', step: 9, key: 's9n_expense_marketing', label: 'Расходы: маркетинг' }

describe('staleMetricRowIds', () => {
  it('flags a picked source the metric no longer declares, keeps declared and unknown ones', () => {
    const ids = staleMetricRowIds([
      { id: 'cac-budget', metric_key: 'biz.marketing.cac', picked: CAC_BUDGET },
      { id: 'cac-real', metric_key: 'biz.marketing.cac', picked: { type: 'survey', step: 2, key: 's2_cac', label: 'другой текст подписи' } },
      { id: 'cac-table', metric_key: 'biz.marketing.cac', picked: { type: 'survey', key: 's8n_metrics_table', coerce: { kind: 'table_cell', row: 'cac' } } },
      { id: 'cac-table-wrong-row', metric_key: 'biz.marketing.cac', picked: { type: 'survey', key: 's8n_metrics_table', coerce: { kind: 'table_cell', row: 'ltv' } } },
      { id: 'avg-revenue', metric_key: 'goal.03.sredniy_chek', picked: { type: 'survey', step: 9, key: 's9n_revenue_2024' } },
      // The whole marketing budget is not a cost per lead either (W4): CPL is
      // the table cell, a document or the formula budget ÷ leads.
      { id: 'cpl-budget', metric_key: 'goal.01.stoimost_lida_cpl', picked: CAC_BUDGET },
      { id: 'doc', metric_key: 'goal.03.sredniy_chek', picked: { type: 'document', doc_type: 'pl_report', field: 'avg_check' } },
      { id: 'no-provenance', metric_key: 'biz.marketing.cac', picked: null },
      { id: 'unknown-metric', metric_key: 'legacy.something', picked: CAC_BUDGET },
    ])
    expect(ids.sort()).toEqual(['avg-revenue', 'cac-budget', 'cac-table-wrong-row', 'cpl-budget'])
  })

  it('every declared source of every metric is recognised as declared', () => {
    const declared = getMetricById('biz.marketing.cac')!.sources
    expect(staleMetricRowIds(declared.map((s, i) => ({ id: String(i), metric_key: 'biz.marketing.cac', picked: s })))).toEqual([])
    expect(sourceIdentity({ type: 'missing' })).toBeNull()
  })
})

type StoredRow = { id: string; metric_key: string; picked: unknown; source?: string; period_year?: null; period_quarter?: null; period_month?: number | null; scenario?: string | null }

function fakeWriteClient(stored: StoredRow[], opts: { selectError?: string } = {}) {
  const calls: string[] = []
  const deleted: string[] = []
  const upsert = vi.fn(async () => { calls.push('upsert'); return { error: null } })
  const client = {
    from: () => {
      let op = 'select'
      const b: Record<string, unknown> = {
        select: () => b,
        delete: () => { op = 'delete'; return b },
        eq: () => b,
        in: (_c: string, ids: string[]) => { if (op === 'delete') deleted.push(...ids); return b },
        upsert,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          calls.push(op)
          const out = op === 'select'
            ? (opts.selectError ? { data: null, error: { message: opts.selectError } } : { data: stored.filter((r) => !deleted.includes(r.id)), error: null })
            : { data: null, error: null }
          return Promise.resolve(out).then(res, rej)
        },
      }
      return b
    },
  }
  return { client: client as unknown as SupabaseClient, calls, deleted, upsert }
}

const ctx = (answers: Record<string, unknown>): ResolverContext => ({
  companyId: 'co-1', userId: 'u-1', surveyAnswers: answers, documents: [], now: new Date('2026-10-06T00:00:00Z'),
})

describe('materializeAll — stale rows', () => {
  it('deletes the stale CAC row before the upsert, even though CAC no longer resolves', async () => {
    const w = fakeWriteClient([
      { id: 'old-cac', metric_key: 'biz.marketing.cac', picked: CAC_BUDGET, source: 'survey', period_year: null, period_quarter: null },
      { id: 'ok-check', metric_key: 'biz.prodazhi.sredniy_chek', picked: { type: 'survey', step: 2, key: 's2_avg_check' }, source: 'survey', period_year: null, period_quarter: null },
    ])
    const { result, values } = await materializeAll(w.client, ctx({ s2_avg_check: 12_000, s9n_expense_marketing: 4_000_000 }))
    expect(values.find((v) => v.metricId === 'biz.marketing.cac')?.picked).toBeNull()
    expect(w.deleted).toEqual(['old-cac'])
    expect(result.pruned).toBe(1)
    expect(w.calls.indexOf('delete')).toBeLessThan(w.calls.indexOf('upsert'))
    expect(result.errors).toEqual([])
  })

  it('a failed read of the stored rows is reported, not ignored', async () => {
    const w = fakeWriteClient([], { selectError: 'permission denied' })
    const { result } = await materializeAll(w.client, ctx({ s2_avg_check: 12_000 }))
    expect(result.errors).toEqual([
      { metricId: '*prune', error: 'permission denied' },
      { metricId: '*superseded', error: 'permission denied' },
    ])
    expect(w.upsert).toHaveBeenCalled()
  })
})

describe('materializeAll — one current row per metric', () => {
  it('after the write removes rows of other sources and of metrics that no longer resolve', async () => {
    const w = fakeWriteClient([
      // revenue now comes from the survey; the old document row is superseded
      { id: 'rev-doc', metric_key: 'biz.finansy.vyruchka_god', picked: { type: 'document', doc_type: 'pl_report', field: 'revenue' }, source: 'document', period_year: null, period_quarter: null },
      { id: 'rev-survey', metric_key: 'biz.finansy.vyruchka_god', picked: { type: 'survey', step: 9, key: 's9n_revenue_2024' }, source: 'survey', period_year: null, period_quarter: null },
      // NPS was answered before and is cleared now → no value any more
      { id: 'nps-old', metric_key: 'biz.marketing.nps', picked: { type: 'survey', step: 7, key: 's7_nps_score' }, source: 'survey', period_year: null, period_quarter: null },
      // never touched: unknown metric keys, month / scenario rows
      { id: 'other', metric_key: 'legacy.something', picked: null, source: 'manual', period_year: null, period_quarter: null },
      { id: 'monthly', metric_key: 'biz.finansy.vyruchka_god', picked: null, source: 'manual', period_year: null, period_quarter: null, period_month: 3 },
    ])
    const { result } = await materializeAll(w.client, ctx({ s9n_revenue_2024: 50_000_000 }))
    expect(result.errors).toEqual([])
    expect(w.deleted.sort()).toEqual(['nps-old', 'rev-doc'])
    expect(result.superseded).toBe(2)
    expect(w.calls.lastIndexOf('delete')).toBeGreaterThan(w.calls.indexOf('upsert'))
  })
})
