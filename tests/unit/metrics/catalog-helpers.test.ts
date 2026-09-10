import { describe, it, expect } from 'vitest'
import { applyGriSectionScores, countByNamespace, GRI_SECTION_BY_LABEL, GRI_SCORE_UNIT } from '@/lib/metrics/catalog-helpers'
import { getMetricRegistry } from '@/lib/metrics/registry'

const NOW = new Date('2026-09-08T12:00:00Z')

describe('countByNamespace (E2E #8 — «Все» collapsed to 0)', () => {
  it('counts every namespace plus the grand total', () => {
    const c = countByNamespace(getMetricRegistry())
    expect(c.all).toBe(c.biz + c.kpi + c.gri + c.goal)
    expect(c.gri).toBe(7)
    expect(c.all).toBeGreaterThan(100)
  })
})

describe('applyGriSectionScores (E2E #7 — GRI metrics «Нет данных»)', () => {
  const griItems = getMetricRegistry()
    .filter((e) => e.namespace === 'gri')
    .map((e) => ({ namespace: e.namespace, label: e.label, value: null, unit: '', confidence: null, source: null, computedAt: null, fresh: false }))

  it('every GRI catalog label maps to a section id', () => {
    for (const it of griItems) expect(GRI_SECTION_BY_LABEL[it.label], it.label).toBeTruthy()
  })

  it('fills values from section_avgs and marks provenance', () => {
    const out = applyGriSectionScores(
      griItems,
      {
        section_avgs: { 'product-demand': 7.4, 'trust-positioning': 9, 'business-model': 8.25, 'cash-stability': 0 },
        created_at: '2026-09-08T11:00:00Z',
      },
      24 * 60 * 60 * 1000,
      NOW,
    )
    const product = out.find((i) => i.label === 'Продукт и спрос')!
    expect(product.value).toBe(7.4)
    expect(product.unit).toBe(GRI_SCORE_UNIT)
    expect(product.source).toBe('gri_assessment')
    expect(product.fresh).toBe(true)
    // zero = not scored → stays empty rather than showing a fake 0
    expect(out.find((i) => i.label === 'Стабильность кассы')!.value).toBeNull()
    expect(out.find((i) => i.label === 'Команда')!.value).toBeNull()
  })

  it('does not override a materialized value and tolerates a missing assessment', () => {
    const withValue = [{ ...griItems[0], value: 5 }]
    expect(applyGriSectionScores(withValue, { section_avgs: { 'product-demand': 7 }, created_at: null }, 1000, NOW)[0].value).toBe(5)
    expect(applyGriSectionScores(griItems, null, 1000, NOW)).toEqual(griItems)
  })
})
