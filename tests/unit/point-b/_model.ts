/**
 * Shared builders for the Point B model tests: PointBInputs / ModelInputs with sensible e-commerce
 * numbers (base 60M, goal 120M in 12 months, 300 leads × 12% × 185 000 ₸), overridable per test.
 */
import { FINMODEL_KEYS, type FinmodelKey } from '@/lib/point-b/finmodel/keys'
import { mergeFinmodel, type FinmodelRow, type FinmodelState } from '@/lib/point-b/finmodel/store'
import type { FinmodelFacts } from '@/lib/point-b/finmodel/sources'
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

// ─── level 2 (finmodel) ─────────────────────────────────────────────────────

/** A complete, round finmodel of the e-commerce golden client (money in ₸, tax as a fraction, days). */
export const FULL_FINMODEL: Record<FinmodelKey, number> = {
  cash_balance: 4_000_000,
  fixed_costs_month: 500_000,
  payroll_month: 1_000_000,
  debt_total: 0,
  debt_service_month: 0,
  interest_rate_annual: 0,
  dso_days: 7,
  dio_days: 30,
  dpo_days: 14,
  tax_rate: 0.1,
  capex_year: 1_200_000,
}

/**
 * A FinmodelState built by the REAL merge: every key of `over` that is a number is an owner entry, `null`
 * removes the key (a missing hard input, or an industry default for tax and the working-capital days).
 */
export function finmodelState(
  over: Partial<Record<FinmodelKey, number | null>> = {},
  opts: { template?: ModelInputs['template']; facts?: FinmodelFacts } = {},
): FinmodelState {
  const all: Partial<Record<FinmodelKey, number | null>> = { ...FULL_FINMODEL, ...over }
  const rows: FinmodelRow[] = FINMODEL_KEYS.flatMap((key) => {
    const value = all[key]
    return typeof value === 'number'
      ? [{ key, value, period_key: '', as_of: null, origin: 'owner', status: 'entered', note: null, verified_by_name: null, verified_at: null, updated_at: '2026-10-18T08:00:00Z' }]
      : []
  })
  return mergeFinmodel({ rows, survey: {}, template: opts.template ?? 'ecommerce', facts: opts.facts })
}

/** modelInputs() of the golden e-commerce client with a gross margin of 40% and a complete finmodel. */
export function modelInputsL2(
  over: Parameters<typeof modelInputs>[0] = {},
  fin: Parameters<typeof finmodelState>[0] = {},
  opts: Parameters<typeof finmodelState>[1] = {},
): ModelInputs {
  return modelInputs({
    grossMargin: src(0.4),
    finmodel: finmodelState(fin, { template: over.template ?? 'ecommerce', ...opts }),
    ...over,
    levers: { avgCheck: src(140_000), cac: src(10_000), headcount: src(10), ...over.levers },
  })
}
