/**
 * Shared builders for the Point B model tests: PointBInputs / ModelInputs with sensible e-commerce
 * numbers (base 60M, goal 120M in 12 months, 300 leads × 12% × 185 000 ₸), overridable per test.
 */
import type { PointBInputs } from '@/lib/point-b/inputs'
import type { ModelInputs, Sourced } from '@/lib/point-b/model/types'

export const REVENUE = 'biz.finansy.vyruchka_god'
export const NOW = new Date('2026-10-18T09:00:00Z')

export const src = (value: number | null, origin: Sourced<number>['origin'] = 'fact'): Sourced<number> =>
  value === null ? { value: null, origin: null, period: null } : { value, origin, period: null }

/** `YYYY-MM` months starting at `from`, `values.length` long. */
export function monthly(from: string, values: number[]): ModelInputs['history'] {
  const [y, m] = from.split('-').map(Number)
  return values.map((revenue, i) => {
    const idx = y * 12 + (m - 1) + i
    return { period: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`, revenue }
  })
}

export function pointBInputs(over: { metrics?: Record<string, number | null>; base?: Partial<PointBInputs['base']> } = {}): PointBInputs {
  return {
    userId: 'u1',
    companyId: 'c1',
    diagnostic: { id: 'd1' },
    snapshot: null,
    blocksWithoutData: [],
    pointA: null,
    answers: {},
    griTop5: undefined,
    metricOptions: { currentRevenueYear: 60_000_000, metrics: over.metrics ?? {} },
    goal12mYear: 120_000_000,
    goal3yYear: null,
    base: { revenue: 60_000_000, period: '2026', ageMonths: 0, stale: false, ...over.base },
  } as PointBInputs
}

export const FUNNEL_METRICS = {
  'biz.marketing.lidov_v_mes': 300,
  'biz.marketing.konversiya_lid_klient': 12,
  'biz.prodazhi.sredniy_chek': 185_000,
}

/** ModelInputs of an e-commerce client with a full funnel (activeBase derived 432). */
export function modelInputs(over: Partial<Omit<ModelInputs, 'levers'>> & { levers?: Partial<ModelInputs['levers']> } = {}): ModelInputs {
  const { levers, ...rest } = over
  return {
    template: 'ecommerce',
    base: { revenueYear: { value: 60_000_000, origin: 'fact', period: '2026' }, ageMonths: 0, stale: false },
    levers: {
      leads: src(300),
      conversion: src(0.12),
      avgCheck: src(185_000),
      repeat: src(null),
      activeBase: src(432, 'derived'),
      cac: src(null),
      headcount: src(null),
      ...levers,
    },
    history: [],
    goal: { metricKey: REVENUE, targetAnnual: 120_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' },
    now: NOW.toISOString(),
    ...rest,
  }
}
