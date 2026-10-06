/**
 * Resolver cost with documents full of labels the synonym dictionary does not
 * know (lib/documents/synonyms.ts matchSynonym, lib/metrics/source-adapters.ts).
 * Every document source of every metric used to re-run the synonym scan for
 * every field — and the scan re-sorted ~560 synonyms per call: 2 documents ×
 * 60 unknown labels took seconds. Sorted synonyms are built once, the
 * canonical key of a field and the derived fields of a document are computed
 * once per resolve.
 */
import { describe, expect, it } from 'vitest'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import type { ResolverContext, ResolverDocument } from '@/lib/metrics/types'

function unknownDoc(id: string, docType: string): ResolverDocument {
  const fields = Array.from({ length: 60 }, (_, i) => ({
    key: `колонка ${id} ${i} показатель склада номер ${i * 7}`,
    label: `Неизвестный параметр учёта ${i} по филиалу ${id}`,
    value: 1000 + i,
  }))
  return { id, docType, parsedData: { fields }, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', fileName: `${id}.xlsx` }
}

describe('resolver performance with unknown document labels', () => {
  it('2 documents × 60 unknown labels resolve every metric well under the bound', () => {
    const ctx: ResolverContext = {
      companyId: 'co', userId: 'u', surveyAnswers: { s1_current_revenue_year: 66_000_000 },
      documents: [unknownDoc('a', 'financial_report'), unknownDoc('b', 'marketing_report')],
      now: new Date('2026-10-06T00:00:00Z'),
    }
    resolveAllMetrics(ctx) // warm-up (module-level indexes)
    const t0 = performance.now()
    const values = resolveAllMetrics(ctx)
    const ms = performance.now() - t0
    expect(values.find((v) => v.metricId === 'biz.finansy.vyruchka_god')?.numeric).toBe(66_000_000)
    // Target < 300 ms on a dev machine; generous bound for slow CI.
    expect(ms).toBeLessThan(1500)
  })
})
