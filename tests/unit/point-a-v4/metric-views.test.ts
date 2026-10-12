import { describe, it, expect } from 'vitest'
import { blockMetricIds, DEFAULT_KEY_METRICS, keyMetricCatalog, loadMetricViews, toMetricView, whereToGet } from '@/lib/point-a/v4/metric-views'
import { getMetricById } from '@/lib/metrics/registry'
import { memoryClient } from '../data-layer/memory-client'

describe('metrics of a block', () => {
  it('own key metrics first, then the departments of the block', () => {
    const fin = blockMetricIds('finance')
    expect(fin[0]).toBe('biz.finansy.vyruchka_god')
    expect(fin).toContain('biz.finansy.ebitda')
    expect(blockMetricIds('team')).toContain('biz.hr.tekuchest_kadrov')
    expect(new Set(fin).size).toBe(fin.length)
  })
  it('default key metrics and the catalog exist in the registry', () => {
    for (const id of DEFAULT_KEY_METRICS) expect(getMetricById(id)).toBeTruthy()
    expect(keyMetricCatalog().length).toBeGreaterThan(50)
  })
})

describe('toMetricView', () => {
  const rev = getMetricById('biz.finansy.vyruchka_god')!
  it('value, period, source, description, dynamics', () => {
    const v = toMetricView(rev, { value: 66_000_000, period: '2026', source: 'survey', confidence: 0.9 }, [60_000_000, 66_000_000])
    expect(v).toMatchObject({ value: 66_000_000, period: '2026', source: 'анкета', trend: { previous: 60_000_000, deltaPct: 10, direction: 'up' }, needs: null })
    expect(v.what).toMatch(/денег/)
    expect(v.why).toBeTruthy()
  })
  it('no value: where to get it', () => {
    const v = toMetricView(rev, undefined, [])
    expect(v.value).toBeNull()
    expect(v.needs).toBe(whereToGet(rev))
    expect(v.needs).toMatch(/^Анкета, шаг/)
  })
})

describe('loadMetricViews', () => {
  it('reads current values and history of the company', async () => {
    const m = memoryClient({
      metrics: [{ company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', metric_value: 66_000_000, source: 'survey', confidence: 0.9, computed_at: '2026-10-01T00:00:00Z', provenance: { period: { year: 2026, month: 10 } } }],
      metric_value_history: [
        { company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', value: 66_000_000, recorded_at: '2026-10-01' },
        { company_id: 'co', metric_key: 'biz.finansy.vyruchka_god', value: 60_000_000, recorded_at: '2026-06-01' },
      ],
    })
    const [v, nps] = await loadMetricViews(m.client, 'co', ['biz.finansy.vyruchka_god', 'biz.klienty.nps'])
    expect(v).toMatchObject({ value: 66_000_000, period: '10.2026', history: [60_000_000, 66_000_000] })
    expect(nps.value).toBeNull()
  })
})
