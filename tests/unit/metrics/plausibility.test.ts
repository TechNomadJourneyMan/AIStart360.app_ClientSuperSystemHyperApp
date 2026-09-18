import { describe, it, expect } from 'vitest'
import { resolveMetric, isPlausibleForUnit } from '@/lib/metrics/resolver'
import { getMetricRegistry } from '@/lib/metrics/registry'
import type { ResolverContext } from '@/lib/metrics/types'
import type { MetricSource } from '@/lib/metrics/descriptions'

function makeCtx(surveyAnswers: Record<string, unknown>): ResolverContext {
  return { companyId: 'co-1', userId: 'user-1', surveyAnswers, documents: [], now: new Date('2026-09-08T00:00:00Z') }
}

describe('unit plausibility gate (E2E #6 «Валовая маржа = 119.1 млн%»)', () => {
  it('isPlausibleForUnit rejects money-sized numbers for % metrics only', () => {
    expect(isPlausibleForUnit('%', 34.2)).toBe(true)
    expect(isPlausibleForUnit('%', 119_100_000)).toBe(false)
    expect(isPlausibleForUnit('₸', 119_100_000)).toBe(true)
    expect(isPlausibleForUnit('%', null)).toBe(true)
  })

  it('a ₸ survey key wired into a % metric is downgraded to a miss', () => {
    const entry = {
      id: 'test.margin',
      namespace: 'biz' as const,
      label: 'Маржа',
      unit: '%',
      sources: [
        { type: 'survey', key: 's9n_expense_cogs' } as MetricSource,
        { type: 'survey', key: 's2_gross_margin' } as MetricSource,
      ],
    }
    const v = resolveMetric('test.margin', makeCtx({ s9n_expense_cogs: 119_100_000, s2_gross_margin: 34 }), { entry })
    expect(v.numeric).toBe(34)
    const cogs = v.considered.find((a) => a.source.key === 's9n_expense_cogs')
    expect(cogs?.status).toBe('miss')
    expect(cogs?.reason).toMatch(/implausible/)
  })

  it('with only the ₸ key the metric stays unresolved instead of lying', () => {
    const entry = {
      id: 'test.margin2',
      namespace: 'biz' as const,
      label: 'Маржа',
      unit: '%',
      sources: [{ type: 'survey', key: 's9n_expense_cogs' } as MetricSource],
    }
    const v = resolveMetric('test.margin2', makeCtx({ s9n_expense_cogs: 119_100_000 }), { entry })
    expect(v.value).toBeNull()
  })

  it('registry: «Валовая маржа» no longer lists an absolute-money survey source', () => {
    const entry = getMetricRegistry().find((e) => e.label === 'Валовая маржа' && e.namespace === 'biz')
    expect(entry).toBeTruthy()
    expect(entry!.sources.some((s) => s.type === 'survey' && s.key === 's9n_expense_cogs')).toBe(false)
  })

  it('registry: the candy demo metric is gone, an industry-neutral «Доля рынка» remains', () => {
    const labels = getMetricRegistry().map((e) => e.label)
    expect(labels.some((l) => /конфет/i.test(l))).toBe(false)
    expect(labels).toContain('Доля рынка')
  })
})

describe('registry unit inference (E2E 2026-09-10: «LTV/CAC 31₸», «28count»)', () => {
  it('ratios are unitless, conversions are %', () => {
    const reg = getMetricRegistry()
    const byLabel = (l: string) => reg.find((e) => e.label === l)
    expect(byLabel('LTV/CAC')?.unit).toBe('')
    expect(byLabel('Себестоимость (индекс)')?.unit).toBe('')
    expect(byLabel('Конверсия лид→клиент')?.unit).toBe('%')
    expect(byLabel('CAC')?.unit).toBe('₸')
  })
})
