import { describe, it, expect } from 'vitest'
import { dedupeFacts, flagAnomalies, applyFreshness, normalizeFacts } from '@/lib/data-layer/normalize'
import { reconcile } from '@/lib/data-layer/reconcile'
import { collectFacts } from '@/lib/data-layer/facts'
import { periodKey } from '@/lib/data-layer/period-key'
import type { Fact, FactSourceKind } from '@/lib/data-layer/types'

const M = 'biz.finansy.vyruchka_god'
const NOW = new Date('2026-10-12T00:00:00Z')

function f(year: number | null, value: number, sourceKind: FactSourceKind = 'survey', ref = `${sourceKind}:${year}:${value}`, extra: Partial<Fact> = {}): Fact {
  const period = year === null ? null : { year, quarter: null, month: null }
  return { metricId: M, period, periodKey: periodKey(period), value, unit: '₸', sourceKind, sourceRef: ref, sourceRefs: [ref], confidence: 0.8, flags: [], observedAt: null, ...extra }
}

describe('dedupeFacts', () => {
  it('merges the same value of one period from several sources', () => {
    const out = dedupeFacts([f(2024, 10_000_000, 'document', 'document:d1#revenue'), f(2024, 10_040_000, 'survey', 'survey:s9n_revenue_2024')])
    expect(out).toHaveLength(1)
    expect(out[0].sourceKind).toBe('survey')
    expect(out[0].sourceRefs.sort()).toEqual(['document:d1#revenue', 'survey:s9n_revenue_2024'])
    expect(out[0].flags).toContain('confirmed')
    expect(out[0].confidence).toBeCloseTo(0.9)
  })

  it('keeps different values and different periods apart', () => {
    expect(dedupeFacts([f(2024, 10_000_000), f(2024, 10_100_000, 'document')])).toHaveLength(2)
    expect(dedupeFacts([f(2024, 10_000_000), f(2025, 10_000_000, 'document')])).toHaveLength(2)
    expect(dedupeFacts([f(null, 10_000_000), f(null, 10_000_000, 'document')])).toHaveLength(2)
  })
})

describe('flagAnomalies', () => {
  it('3 periods: more than 3× off the median; 2 periods are never judged', () => {
    const out = flagAnomalies([f(2023, 10), f(2024, 11), f(2025, 100)])
    expect(out.find((x) => x.periodKey === '2025')!.flags).toContain('anomaly')
    expect(out.find((x) => x.periodKey === '2024')!.flags).not.toContain('anomaly')
    expect(flagAnomalies([f(2024, 10), f(2025, 100)]).some((x) => x.flags.includes('anomaly'))).toBe(false)
  })

  it('≥ 4 periods: robust z-score', () => {
    const out = flagAnomalies([f(2021, 10), f(2022, 11), f(2023, 12), f(2024, 11), f(2025, 60)])
    expect(out.filter((x) => x.flags.includes('anomaly')).map((x) => x.periodKey)).toEqual(['2025'])
  })

  it('steady growth is not an anomaly; MAD = 0 is not a division by zero', () => {
    expect(flagAnomalies([f(2023, 10), f(2024, 15), f(2025, 22)]).some((x) => x.flags.includes('anomaly'))).toBe(false)
    expect(flagAnomalies([f(2021, 10), f(2022, 10), f(2023, 10), f(2024, 10)]).some((x) => x.flags.includes('anomaly'))).toBe(false)
  })
})

describe('applyFreshness', () => {
  it('a current-situation answer older than 6 months goes stale; a past period never does', () => {
    const old = '2026-01-01T00:00:00Z'
    const out = applyFreshness([f(2026, 1, 'survey', 'a', { current: true, observedAt: old }), f(2024, 1, 'survey', 'b', { observedAt: old }), f(2026, 1, 'survey', 'c', { current: true, observedAt: '2026-09-01T00:00:00Z' })], NOW)
    expect(out.map((x) => x.flags.includes('stale'))).toEqual([true, false, false])
    expect(out[0].confidence).toBeCloseTo(0.64)
  })
})

describe('reconcile', () => {
  it('survey vs document of the same year → one conflict, the survey value stays in use', () => {
    const d = reconcile([f(2024, 10_000_000, 'survey'), f(2024, 14_000_000, 'document')])
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'conflict', periodKey: '2024', chosenValue: 10_000_000 })
    expect(d[0].candidates.map((c) => c.sourceKind)).toEqual(['survey', 'document'])
  })

  it('different periods are history, not a conflict', () => {
    expect(reconcile([f(2026, 10_000_000, 'survey'), f(2025, 14_000_000, 'document')])).toEqual([])
  })

  it('a difference within 5 % is not a conflict', () => {
    expect(reconcile([f(2024, 10_000_000, 'survey'), f(2024, 10_300_000, 'document')])).toEqual([])
  })

  it('two documents of one year that disagree conflict', () => {
    expect(reconcile([f(2024, 10_000_000, 'document', 'document:a#revenue'), f(2024, 14_000_000, 'document', 'document:b#revenue')])[0]?.kind).toBe('conflict')
  })

  it('a manual value settles the period', () => {
    expect(reconcile([f(2024, 10_000_000, 'survey'), f(2024, 14_000_000, 'document'), f(2024, 12_000_000, 'manual')])).toEqual([])
  })

  it('invalid and anomaly facts become discrepancies of their own', () => {
    const d = reconcile([f(2024, 1, 'survey', 'x', { flags: ['invalid'] }), f(2025, 2, 'survey', 'y', { flags: ['anomaly'] })])
    expect(d.map((x) => x.kind).sort()).toEqual(['anomaly', 'invalid'])
    expect(d.find((x) => x.kind === 'invalid')!.chosenValue).toBeNull()
  })

  it('end to end: the same inputs read by two catalog metrics are reported once', () => {
    const facts = normalizeFacts(
      collectFacts({
        companyId: 'co', userId: 'u', now: NOW,
        surveyAnswers: { s9n_revenue_2024: 10_000_000 },
        documents: [{ id: 'd1', docType: 'pl_report', periodYear: 2024, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', parsedData: { fields: [{ key: 'revenue', value: 14_000_000, confidence: 0.9 }] } }],
      }),
      NOW,
    )
    const conflicts = reconcile(facts).filter((d) => d.kind === 'conflict' && d.periodKey === '2024')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].candidates.map((c) => c.value)).toEqual([10_000_000, 14_000_000])
  })
})
