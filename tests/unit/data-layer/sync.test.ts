import { describe, it, expect } from 'vitest'
import { syncDataLayer, sameCandidates } from '@/lib/data-layer/sync'
import type { ResolverContext, ResolverDocument } from '@/lib/metrics/types'
import { memoryClient, type Row } from './memory-client'

const NOW = new Date('2026-10-12T00:00:00Z')
function pl(revenue: number): ResolverDocument {
  return { id: 'd1', docType: 'pl_report', periodYear: 2024, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', parsedData: { fields: [{ key: 'revenue', value: revenue, confidence: 0.9 }] } }
}
function ctx(over: Partial<ResolverContext> = {}): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers: { s9n_revenue_2024: 10_000_000 }, documents: [pl(14_000_000)], now: NOW, ...over }
}
const conflicts = (db: Record<string, Row[]>) => db.data_discrepancies.filter((r) => r.kind === 'conflict')

describe('syncDataLayer', () => {
  it('writes facts and opens a discrepancy', async () => {
    const { client, db } = memoryClient()
    const r = await syncDataLayer(client, ctx())
    expect(r.error).toBeNull()
    expect(r.facts).toBe(db.metric_facts.length)
    expect(db.metric_facts.some((f) => f.period_key === '2024' && f.source_kind === 'document' && f.value === 14_000_000)).toBe(true)
    expect(conflicts(db)).toHaveLength(1)
    expect(conflicts(db)[0]).toMatchObject({ status: 'open', period_key: '2024', chosen_value: 10_000_000, company_id: 'co' })
    expect(r.opened).toBeGreaterThan(0)
  })

  it('rebuilds facts and does not duplicate an open discrepancy', async () => {
    const { client, db } = memoryClient()
    await syncDataLayer(client, ctx())
    const facts = db.metric_facts.length
    const r = await syncDataLayer(client, ctx())
    expect(db.metric_facts).toHaveLength(facts)
    expect(conflicts(db)).toHaveLength(1)
    expect(r.opened).toBe(0)
  })

  it('auto-resolves a discrepancy whose cause is gone', async () => {
    const { client, db } = memoryClient()
    await syncDataLayer(client, ctx())
    const r = await syncDataLayer(client, ctx({ documents: [pl(10_100_000)] }))
    expect(conflicts(db)[0].status).toBe('auto_resolved')
    expect(r.autoResolved).toBeGreaterThan(0)
  })

  it('does not reopen what the owner resolved while the values stay the same; reopens when they change', async () => {
    const { client, db } = memoryClient()
    await syncDataLayer(client, ctx())
    conflicts(db)[0].status = 'ignored'
    await syncDataLayer(client, ctx())
    expect(conflicts(db)).toHaveLength(1)
    await syncDataLayer(client, ctx({ documents: [pl(16_000_000)] }))
    expect(conflicts(db).map((r) => r.status).sort()).toEqual(['ignored', 'open'])
  })

  it('a manual value for the period settles the conflict', async () => {
    const { client, db } = memoryClient()
    await syncDataLayer(client, ctx())
    await syncDataLayer(client, ctx({ periodOverrides: [{ id: 'o1', metricId: 'biz.finansy.vyruchka_god', periodKey: '2024', value: 14_000_000 }, { id: 'o2', metricId: 'kpi.obschaya_vyruchka_god', periodKey: '2024', value: 14_000_000 }] }))
    expect(conflicts(db).every((r) => r.status === 'auto_resolved')).toBe(true)
  })

  it('before migration 110: not_migrated, nothing thrown', async () => {
    const { client } = memoryClient({}, { missing: ['metric_facts'] })
    expect((await syncDataLayer(client, ctx())).error).toBe('not_migrated')
  })
})

describe('sameCandidates', () => {
  it('ignores order', () => {
    const a = { value: 1, unit: '₸', sourceKind: 'survey' as const, sourceRef: 'a', confidence: 1 }
    const b = { ...a, value: 2, sourceRef: 'b' }
    expect(sameCandidates([a, b], [b, a])).toBe(true)
    expect(sameCandidates([a], [a, b])).toBe(false)
  })
})
