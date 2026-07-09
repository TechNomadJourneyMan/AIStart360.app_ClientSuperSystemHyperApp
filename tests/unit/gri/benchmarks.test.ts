import { describe, it, expect } from 'vitest'
import {
  INDUSTRY_BENCHMARKS,
  listIndustries,
  computeGaps,
} from '@/lib/gri/benchmarks'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

const AVGS: Record<string, number> = {
  'product-demand': 6.5,
  'trust-positioning': 5.8,
  'business-model': 4.2,
  'cash-stability': 5.0,
  operations: 3.1,
  team: 6.0,
  'owner-readiness': 9.9,
}

describe('INDUSTRY_BENCHMARKS — ориентиры v1', () => {
  it('6 отраслей, у каждой все 7 блоков GRI', () => {
    const ids = Object.keys(INDUSTRY_BENCHMARKS)
    expect(ids).toHaveLength(6)
    expect(ids).toContain('universal')
    for (const industry of Object.values(INDUSTRY_BENCHMARKS)) {
      for (const s of GRI_SECTIONS) {
        expect(industry.blocks[s.id]).toBeDefined()
      }
    }
  })

  it('значения реалистичны: median 4.5–6.0, top20 7.0–8.5, top20 > median', () => {
    for (const industry of Object.values(INDUSTRY_BENCHMARKS)) {
      for (const { median, top20 } of Object.values(industry.blocks)) {
        expect(median).toBeGreaterThanOrEqual(4.5)
        expect(median).toBeLessThanOrEqual(6.0)
        expect(top20).toBeGreaterThanOrEqual(7.0)
        expect(top20).toBeLessThanOrEqual(8.5)
        expect(top20).toBeGreaterThan(median)
      }
    }
  })
})

describe('listIndustries', () => {
  it('возвращает 6 отраслей с русскими подписями', () => {
    const list = listIndustries()
    expect(list).toHaveLength(6)
    expect(list.map((i) => i.id)).toContain('universal')
    for (const i of list) {
      expect(typeof i.labelRu).toBe('string')
      expect(i.labelRu.length).toBeGreaterThan(0)
    }
  })
})

describe('computeGaps', () => {
  it('возвращает 7 блоков в порядке GRI_SECTIONS с русскими подписями', () => {
    const gaps = computeGaps(AVGS, 'retail')
    expect(gaps).toHaveLength(7)
    expect(gaps.map((g) => g.blockId)).toEqual(GRI_SECTIONS.map((s) => s.id))
    expect(gaps[0].blockLabelRu).toBe('Продукт и спрос')
    expect(gaps[6].blockLabelRu).toBe('Готовность собственника')
  })

  it('gap = top20 − you (округлён до 0.1), отрицательный когда вы выше топ-20%', () => {
    const gaps = computeGaps(AVGS, 'retail')
    const ops = gaps.find((g) => g.blockId === 'operations')!
    expect(ops.you).toBe(3.1)
    expect(ops.top20).toBe(INDUSTRY_BENCHMARKS.retail.blocks.operations.top20)
    expect(ops.gap).toBeCloseTo(ops.top20 - 3.1, 5)

    const owner = gaps.find((g) => g.blockId === 'owner-readiness')!
    // 9.9 выше любого top20 (≤ 8.5) → отрицательный gap.
    expect(owner.gap).toBeLessThan(0)
  })

  it('неизвестная отрасль → фолбэк на universal', () => {
    const unknown = computeGaps(AVGS, 'fintech-space-lasers')
    const universal = computeGaps(AVGS, 'universal')
    expect(unknown).toEqual(universal)
  })

  it('клампит you в 0..10 и терпит мусорные значения', () => {
    const gaps = computeGaps(
      {
        'product-demand': 15,
        'trust-positioning': -3,
        'business-model': NaN,
        // остальные блоки отсутствуют вовсе
      },
      'universal',
    )
    const byId = Object.fromEntries(gaps.map((g) => [g.blockId, g]))
    expect(byId['product-demand'].you).toBe(10)
    expect(byId['trust-positioning'].you).toBe(0)
    expect(byId['business-model'].you).toBe(0)
    expect(byId['operations'].you).toBe(0)
    // gap для отсутствующего блока = сам top20.
    expect(byId['operations'].gap).toBe(byId['operations'].top20)
  })

  it('null/undefined вместо section_avgs не ломает расчёт', () => {
    expect(computeGaps(null, 'services')).toHaveLength(7)
    expect(computeGaps(undefined, 'services')).toHaveLength(7)
    for (const g of computeGaps(null, 'services')) {
      expect(g.you).toBe(0)
      expect(g.gap).toBe(g.top20)
    }
  })
})
