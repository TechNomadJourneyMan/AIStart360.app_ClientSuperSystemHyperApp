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
      { id: 'cpl-budget', metric_key: 'goal.01.stoimost_lida_cpl', picked: CAC_BUDGET }, // still declared for CPL
      { id: 'doc', metric_key: 'goal.03.sredniy_chek', picked: { type: 'document', doc_type: 'pl_report', field: 'avg_check' } },
      { id: 'no-provenance', metric_key: 'biz.marketing.cac', picked: null },
      { id: 'unknown-metric', metric_key: 'legacy.something', picked: CAC_BUDGET },
    ])
    expect(ids.sort()).toEqual(['avg-revenue', 'cac-budget', 'cac-table-wrong-row'])
  })

  it('every declared source of every metric is recognised as declared', () => {
    const declared = getMetricById('biz.marketing.cac')!.sources
    expect(staleMetricRowIds(declared.map((s, i) => ({ id: String(i), metric_key: 'biz.marketing.cac', picked: s })))).toEqual([])
    expect(sourceIdentity({ type: 'missing' })).toBeNull()
  })
})

function fakeWriteClient(stored: Array<{ id: string; metric_key: string; picked: unknown }>, opts: { selectError?: string } = {}) {
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
            ? (opts.selectError ? { data: null, error: { message: opts.selectError } } : { data: stored, error: null })
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
      { id: 'old-cac', metric_key: 'biz.marketing.cac', picked: CAC_BUDGET },
      { id: 'ok-check', metric_key: 'biz.prodazhi.sredniy_chek', picked: { type: 'survey', step: 2, key: 's2_avg_check' } },
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
    expect(result.errors).toEqual([{ metricId: '*prune', error: 'permission denied' }])
    expect(w.upsert).toHaveBeenCalled()
  })
})
