/**
 * P2 of the BI audit, Point B model:
 *  BI-26 — the goal is already reached by the run-rate (PO rule: run-rate × 12 ≥ goal) but there is < 12 months of
 *          history → the verdict was `no_data` «Пока нельзя сказать». Example: 3 M/month (36 M a year), goal 36 M.
 *  BI-28 — a gross margin ≤ 0 (sales below cost) was dropped as «no value»: «Чего не хватает: Валовая маржа»,
 *          money not calculated. Example: margin −5%.
 */
import { describe, expect, it } from 'vitest'
import { computeModel } from '@/lib/point-b/model/compute'
import { verdictFor } from '@/lib/point-b/model/forecast'
import { buildModelInputs } from '@/lib/point-b/model/inputs'
import { determineLevel } from '@/lib/point-b/model/levels'
import type { ModelGoal } from '@/lib/point-b/model/types'
import { FUNNEL_METRICS, NOW, REVENUE, modelInputs, modelInputsL2, pointBInputs, src } from './_model'

const goal36: ModelGoal = { metricKey: REVENUE as ModelGoal['metricKey'], targetAnnual: 36_000_000, deadline: '2027-10-18', months: 12, reviewStatus: 'verified' }
const noHistory = { atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: null, basis: 'insufficient' as const }

describe('BI-26 — the goal reached by the run-rate is said so, not «нельзя сказать»', () => {
  it('BI-26: 3 M/month (36 M a year), goal 36 M, no history → «на курсе: цель достигнута» (was no_data)', () => {
    const v = verdictFor({ goal: goal36, forecast: noHistory, baseAnnual: 36_000_000 })
    expect(v.key).toBe('on_track')
    expect(v.headline).toMatch(/достигнута/)
    expect(v.reason).toMatch(/36 000 000|36 млн/)
  })

  it('BI-26: the whole model — services client, base 36 M, goal 36 M', () => {
    const r = computeModel(modelInputs({
      template: 'services',
      base: { revenueYear: { value: 36_000_000, origin: 'fact', period: '2026' }, ageMonths: 0, stale: false },
      goal: goal36,
    }))
    expect(r.verdict.key).toBe('on_track')
    expect(r.verdict.headline).toMatch(/достигнута/)
  })

  it('BI-26: a stale base does not prove the goal: still «нельзя сказать» without history', () => {
    const v = verdictFor({ goal: goal36, forecast: noHistory, baseAnnual: 36_000_000, baseStale: true })
    expect(v.key).toBe('no_data')
  })

  it('BI-26: below the goal and without history — still no_data (the rule does not invent a forecast)', () => {
    const v = verdictFor({ goal: goal36, forecast: noHistory, baseAnnual: 30_000_000 })
    expect(v.key).toBe('no_data')
  })
})

describe('BI-28 — a gross margin ≤ 0 is a problem, not a missing value', () => {
  it('BI-28: margin −5% from the metrics is kept as −0.05 (was dropped → «нет значения»)', () => {
    const i = buildModelInputs({
      pb: pointBInputs({ metrics: { ...FUNNEL_METRICS, 'biz.finansy.valovaya_marzha': -5 } }),
      history: [], template: 'ecommerce', now: NOW,
      goals: { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null, targetValue: 120_000_000, deadline: null, reviewStatus: 'verified' }] } as never,
    })
    expect(i.grossMargin?.value).toBeCloseTo(-0.05, 10)
  })

  it('BI-28: margin −5% with a complete finmodel → level 2 (money calculated), not «Чего не хватает: Валовая маржа»; a critical warning', () => {
    const inputs = modelInputsL2({ grossMargin: src(-0.05) })
    const lvl = determineLevel(inputs)
    expect(lvl.level).toBe(2)
    expect(lvl.missing.map((m) => m.label).join(' ')).not.toMatch(/маржа/i)
    const r = computeModel(inputs)
    expect(r.level).toBe(2)
    expect(r.warnings.join(' ')).toMatch(/Продажи в убыток/)
    // money is calculated and sales below cost lose money every month
    const s = r.scenarios[0]
    expect(s.finance).toBeDefined()
    expect(s.finance!.ebitda.every((v) => v < 0)).toBe(true)
  })

  it('BI-28: a missing margin is still «нет данных» (MARGIN_MISSING unchanged)', () => {
    const lvl = determineLevel(modelInputsL2({ grossMargin: src(null) }))
    expect(lvl.level).toBe(1)
    expect(lvl.missing.map((m) => m.label).join(' ')).toMatch(/маржа/i)
  })
})
