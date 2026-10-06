import { describe, it, expect } from 'vitest'
import { loadResolvedInputs, resolvedInputsFromMetricRows, resolvedInputsFromValues } from '@/lib/point-a/resolved-inputs'
import { calculatePointA } from '@/lib/point-a-engine'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetricValue } from '@/lib/metrics/types'

const value = (metricId: string, numeric: number, type: 'survey' | 'document' | 'manual'): MetricValue => ({
  metricId, value: numeric, numeric, unit: '', confidence: 0.9,
  picked: { type, key: 'k' }, considered: [], periodYear: null, periodQuarter: null, computedAt: '2026-10-06T00:00:00Z',
})

describe('resolved inputs for the Point A engine', () => {
  it('uses the current metric values of every source — the same values the catalog shows (W4)', () => {
    const out = resolvedInputsFromValues([
      value('goal.04.ltv', 400_000, 'document'),
      value('biz.marketing.cac', 50_000, 'survey'),
      value('goal.09.cac', 80_000, 'manual'),
      value('biz.finansy.valovaya_marzha', 41, 'document'),
      value('biz.prodazhi.tsikl_zakrytiya_sdelki', 21, 'survey'),
      value('goal.02.repeat_purchase_rate', 0, 'survey'),
      value('goal.06.loss_rate', 12.5, 'survey'),
    ])
    expect(out).toEqual({ ltv: 400_000, cac: 50_000, grossMargin: 41, dealCycleDays: 21, repeatSharePct: 0, refusalPct: 12.5 })
  })

  it('from materialised rows: the current row per metric', () => {
    const out = resolvedInputsFromMetricRows([
      { metric_key: 'biz.marketing.ltv_cac', metric_value: '2.5', source: 'document', computed_at: '2026-09-01T00:00:00Z' },
      { metric_key: 'biz.marketing.ltv_cac', metric_value: '3.4', source: 'document', computed_at: '2026-10-01T00:00:00Z' },
      { metric_key: 'goal.04.ltv', metric_value: 1, source: 'survey', computed_at: '2026-10-01T00:00:00Z' },
    ])
    expect(out).toEqual({ ltvCacRatio: 3.4, ltv: 1 })
  })

  it('the engine scores the resolved deal cycle and refusal rate, not its own survey reading', () => {
    const pa = calculatePointA({ s3_deal_cycle_days: 90, s3_deals_2024: 100, s3_rejections_2024: 80 }, { dealCycleDays: 14, refusalPct: 5 })
    const sales = JSON.stringify(pa.blocks.sales)
    expect(sales).not.toMatch(/Длинный цикл сделки/)
    expect(sales).not.toMatch(/Высокий процент отказов/)
  })

  it('a zero or negative document gross margin wins over the survey margin; LTV / CAC stay > 0', () => {
    const out = resolvedInputsFromValues([
      value('biz.finansy.valovaya_marzha', -8, 'document'),
      value('goal.04.ltv', 0, 'document'),
      value('biz.marketing.cac', -1, 'manual'),
    ])
    expect(out).toEqual({ grossMargin: -8 })
    const rows = resolvedInputsFromMetricRows([
      { metric_key: 'biz.finansy.valovaya_marzha', metric_value: '0', source: 'document', computed_at: '2026-10-01T00:00:00Z' },
    ])
    expect(rows).toEqual({ grossMargin: 0 })
    // The engine then reports the problem instead of scoring the survey's 35%.
    const pa = calculatePointA({ s9n_net_margin: 35 }, out)
    expect(JSON.stringify(pa.blocks.finance)).toMatch(/Маржинальность нулевая или отрицательная/)
  })

  it('loadResolvedInputs: a failed read throws (never «no document values»)', async () => {
    const client = {
      from: () => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in']) b[m] = () => b
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } }).then(res)
        return b
      },
    } as unknown as SupabaseClient
    await expect(loadResolvedInputs(client, 'co-1')).rejects.toThrow(/metrics read failed/)
    expect(await loadResolvedInputs(client, null)).toEqual({})
  })
})
