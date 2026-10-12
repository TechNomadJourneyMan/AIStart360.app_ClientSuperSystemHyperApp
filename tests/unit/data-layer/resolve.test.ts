import { describe, it, expect } from 'vitest'
import { syncDataLayer } from '@/lib/data-layer/sync'
import { resolveDiscrepancy } from '@/lib/data-layer/resolve'
import type { ResolverContext } from '@/lib/metrics/types'
import { memoryClient, type Row } from './memory-client'

const NOW = new Date('2026-10-12T00:00:00Z')
const ctx = (over: Partial<ResolverContext> = {}): ResolverContext => ({
  companyId: 'co', userId: 'u', now: NOW, surveyAnswers: { s9n_revenue_2024: 10_000_000 },
  documents: [{ id: 'd1', docType: 'pl_report', periodYear: 2024, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', parsedData: { fields: [{ key: 'revenue', value: 14_000_000, confidence: 0.9 }] } }],
  ...over,
})
const owner = { userId: 'u', expert: false }

async function seeded() {
  const m = memoryClient()
  await syncDataLayer(m.client, ctx())
  const conflict = m.db.data_discrepancies.find((r) => r.kind === 'conflict') as Row
  return { ...m, conflict }
}

/** Overrides as the resolver context gets them (gatherResolverContext). */
const overridesOf = (db: Record<string, Row[]>) =>
  db.metric_overrides.map((o) => ({ id: String(o.id), metricId: String(o.metric_key), periodKey: String(o.period_key), value: Number(o.value) }))

describe('resolveDiscrepancy', () => {
  it('taking the document value writes a manual value for every metric reading the same inputs', async () => {
    const { client, db, conflict } = await seeded()
    const out = await resolveDiscrepancy(client, 'co', String(conflict.id), { choice: 'candidate', index: 1 }, owner)
    expect(out).toMatchObject({ ok: true, status: 'resolved_user', value: 14_000_000 })
    expect(db.metric_overrides.map((o) => o.metric_key).sort()).toEqual(['biz.finansy.vyruchka_god', 'kpi.obschaya_vyruchka_god'])
    expect(conflict.status).toBe('resolved_user')
    // the next materialisation sees the manual value: no conflict reopens for any sibling metric
    await syncDataLayer(client, ctx({ periodOverrides: overridesOf(db) }))
    expect(db.data_discrepancies.filter((r) => r.kind === 'conflict' && r.status === 'open')).toEqual([])
  })

  it('keeping the value in use writes no override and is not reopened', async () => {
    const { client, db, conflict } = await seeded()
    const out = await resolveDiscrepancy(client, 'co', String(conflict.id), { choice: 'candidate', index: 0 }, { userId: 'e', expert: true })
    expect(out).toMatchObject({ ok: true, status: 'resolved_expert', value: 10_000_000, overrides: [] })
    await syncDataLayer(client, ctx())
    expect(db.data_discrepancies.filter((r) => r.kind === 'conflict' && r.status === 'open')).toEqual([])
  })

  it('custom value and ignore', async () => {
    const a = await seeded()
    expect(await resolveDiscrepancy(a.client, 'co', String(a.conflict.id), { choice: 'custom', value: 12_000_000, note: 'по банку' }, owner)).toMatchObject({ ok: true, value: 12_000_000 })
    expect(a.db.metric_overrides[0]).toMatchObject({ value: 12_000_000, note: 'по банку', period_key: '2024', set_by: 'u' })
    const b = await seeded()
    expect(await resolveDiscrepancy(b.client, 'co', String(b.conflict.id), { choice: 'ignore' }, owner)).toMatchObject({ ok: true, status: 'ignored' })
    expect(b.db.metric_overrides).toEqual([])
  })

  it('another company, a closed one and a bad index are refused', async () => {
    const { client, conflict } = await seeded()
    expect(await resolveDiscrepancy(client, 'other', String(conflict.id), { choice: 'ignore' }, owner)).toMatchObject({ ok: false, status: 404 })
    expect(await resolveDiscrepancy(client, 'co', String(conflict.id), { choice: 'candidate', index: 9 }, owner)).toMatchObject({ ok: false, status: 400 })
    await resolveDiscrepancy(client, 'co', String(conflict.id), { choice: 'ignore' }, owner)
    expect(await resolveDiscrepancy(client, 'co', String(conflict.id), { choice: 'ignore' }, owner)).toMatchObject({ ok: false, status: 409 })
  })
})
