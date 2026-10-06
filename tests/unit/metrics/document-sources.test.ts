/**
 * Document values → metrics: synonyms, document-type families, period
 * detection + rescaling, choice by period then recency, unit normalisation and
 * OCR provenance carried into public.metrics provenance.
 */
import { describe, expect, it } from 'vitest'
import { resolveMetric } from '@/lib/metrics/resolver'
import { getMetricById } from '@/lib/metrics/registry'
import { toMaterializedRow } from '@/lib/metrics/materialize'
import { resolveDocumentSource } from '@/lib/metrics/source-adapters'
import { runDocumentPipeline } from '@/lib/documents/pipeline'
import type { ParsedDataShape, ResolverContext, ResolverDocument } from '@/lib/metrics/types'

type Field = NonNullable<ParsedDataShape['fields']>[number]

function doc(id: string, docType: string, fields: Field[], extra: Partial<ResolverDocument> = {}): ResolverDocument {
  return { id, docType, parsedData: { fields }, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', ...extra }
}
function ctx(documents: ResolverDocument[], surveyAnswers: Record<string, unknown> = {}): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers, documents, now: new Date('2026-10-06T00:00:00Z') }
}
const v = (id: string, c: ResolverContext) => resolveMetric(id, c, { entry: getMetricById(id)! })
const f = (key: string, value: unknown, extra: Partial<Field> = {}): Field => ({ key, label: key, value, ...extra })

describe('document fields reach metrics', () => {
  it('a «Финансовый отчёт» (financial_report) feeds the P&L metrics; a free-text label matches through synonyms', () => {
    const c = ctx([doc('d1', 'financial_report', [f('Выручка за год', 72_000_000), f('EBITDA', 14_000_000), f('Себестоимость продаж', 40_000_000)])])
    expect(v('biz.finansy.vyruchka_god', c).numeric).toBe(72_000_000)
    expect(v('kpi.obschaya_vyruchka_god', c).numeric).toBe(72_000_000)
    expect(v('biz.finansy.ebitda', c).numeric).toBe(14_000_000)
    expect(v('kpi.sebestoimost_kpi', c).numeric).toBe(40_000_000)
  })

  it('ads / GA4 exports feed marketing metrics; a business plan never feeds a fact', () => {
    expect(v('biz.marketing.cpl_stoimost_lida', ctx([doc('a', 'ads_report', [f('cpl', 900)])])).numeric).toBe(900)
    expect(v('biz.marketing.posescheniy_sayta_mes', ctx([doc('g', 'ga4_export', [f('Посещения сайта', 12_000)], { periodYear: 2025, periodQuarter: 'Q3' })])).numeric).toBe(4000)
    expect(v('biz.finansy.vyruchka_god', ctx([doc('bp', 'business_plan', [f('revenue', 500_000_000)])])).numeric).toBeNull()
  })

  it('a client registry gives the number of active clients and the repeat share', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      client_id: `c${i}`, name: `n${i}`, first_purchase_date: '2024-01-10',
      last_purchase_date: i < 15 ? '2025-11-01' : '2024-02-01', total_spent_kzt: 100_000, purchase_count: i < 8 ? 3 : 1,
    }))
    const c = ctx([{ id: 'cb', docType: 'client_base', parsedData: { fields: [], client_rows: rows }, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z' }])
    expect(v('biz.klienty.aktivnykh_klientov', c).numeric).toBe(15)
    expect(v('goal.02.repeat_purchase_rate', c).numeric).toBe(40)
  })
})

describe('period detection and rescaling', () => {
  it('a quarterly P&L feeds the yearly revenue ×4, recorded and with lower confidence', () => {
    const q = v('biz.finansy.vyruchka_god', ctx([doc('q1', 'pl_report', [f('revenue', 18_000_000, { confidence: 0.85 })], { periodYear: 2025, periodQuarter: 'Q1' })]))
    expect(q.numeric).toBe(72_000_000)
    const hit = q.considered.find((a) => a.status === 'hit')!
    expect(hit.period).toMatchObject({ source: 'quarter', target: 'year', factor: 4, year: 2025, quarter: 'Q1', basis: 'document' })
    expect(hit.confidence).toBeCloseTo(0.72, 2)
    expect(hit.reason).toMatch(/quarter → year ×4/)
  })

  it('the period written on the field wins; the document text is the last resort', () => {
    const byField = v('biz.finansy.vyruchka_god', ctx([doc('m', 'pl_report', [f('revenue', 6_000_000, { period: 'март 2025' })])]))
    expect(byField.numeric).toBe(72_000_000)
    const byText = v('biz.finansy.vyruchka_god', ctx([{ ...doc('t', 'pl_report', [f('revenue', 20_000_000)]), parsedData: { summary: 'Отчёт о прибылях и убытках за 1 квартал 2025 года', fields: [f('revenue', 20_000_000)] } }]))
    expect(byText.numeric).toBe(80_000_000)
    expect(byText.considered.find((a) => a.status === 'hit')?.period?.basis).toBe('text')
  })

  it('a yearly value feeds a monthly metric ÷12; a ratio is never rescaled', () => {
    const c = ctx([doc('y', 'crm_export', [f('leads_count', 3600), f('conversion_rate', 12)], { periodYear: 2025 })])
    expect(v('biz.marketing.lidov_v_mes', c).numeric).toBe(300)
    expect(v('biz.marketing.konversiya_lid_klient', c).numeric).toBe(12)
  })

  it('picks a full-period value over a rescaled one, then the latest period, then the newest upload', () => {
    const fy2024 = doc('fy24', 'pl_report', [f('revenue', 60_000_000)], { periodYear: 2024, uploadedAt: '2026-10-03T00:00:00Z' })
    const fy2025 = doc('fy25', 'pl_report', [f('revenue', 70_000_000)], { periodYear: 2025, uploadedAt: '2026-09-01T00:00:00Z' })
    const q2026 = doc('q26', 'pl_report', [f('revenue', 20_000_000)], { periodYear: 2026, periodQuarter: 'Q1', uploadedAt: '2026-10-05T00:00:00Z' })
    const r = v('biz.finansy.vyruchka_god', ctx([q2026, fy2024, fy2025]))
    expect(r.numeric).toBe(70_000_000)
    expect(r.considered.find((a) => a.status === 'hit')?.document?.document_id).toBe('fy25')
  })
})

describe('units', () => {
  it('a share written as a fraction becomes a percent; a stated % stays', () => {
    const frac = v('biz.finansy.valovaya_marzha', ctx([doc('p', 'pl_report', [f('gross_margin', 0.34)])]))
    expect(frac.numeric).toBe(34)
    expect(frac.considered.find((a) => a.status === 'hit')?.document?.unit_conversion).toMatch(/0.34 → 34%/)
    expect(v('biz.finansy.valovaya_marzha', ctx([doc('p', 'pl_report', [f('gross_margin', '41%')])])).numeric).toBe(41)
  })

  it('money in another currency or a percent is not a ₸ value', () => {
    expect(v('biz.finansy.vyruchka_god', ctx([doc('usd', 'pl_report', [f('revenue', 150_000, { unit: '$' })])])).numeric).toBeNull()
    expect(v('biz.finansy.vyruchka_god', ctx([doc('pct', 'pl_report', [f('revenue', '+12%')])])).numeric).toBeNull()
  })
})

describe('OCR provenance', () => {
  it('an OCR field keeps its lowered confidence and the engine, page and quote through to public.metrics provenance', () => {
    const ocrField = f('cac', 18_500, {
      confidence: 0.55,
      provenance: { document_id: 'scan', method: 'heuristic', quote: 'CAC: 18 500 тг', page: 1, ocr: true, ocr_engine: 'tesseract', ocr_page_confidence: 81 },
    })
    const value = v('biz.marketing.cac', ctx([doc('scan', 'marketing_report', [ocrField])]))
    expect(value.numeric).toBe(18_500)
    expect(value.confidence).toBeLessThanOrEqual(0.7)
    const row = toMaterializedRow(value, 'co')
    expect(row.source).toBe('document')
    expect(row.provenance).toMatchObject({
      document: { document_id: 'scan', doc_type: 'marketing_report', ocr: true, ocr_engine: 'tesseract', ocr_page_confidence: 81, page: 1, quote: 'CAC: 18 500 тг' },
    })
  })

  it('the explicit metric binding of a field is honoured', () => {
    const attempt = resolveDocumentSource(
      { type: 'document', doc_type: 'pl_report', field: 'revenue' },
      ctx([doc('b', 'pl_report', [{ key: 'строка 12', label: 'строка 12', value: 1000, metric_id: 'biz.finansy.vyruchka_god' }])]),
      'biz.finansy.vyruchka_god',
      getMetricById('biz.finansy.vyruchka_god')!,
    )
    expect(attempt).toMatchObject({ status: 'hit', numeric: 1000 })
  })
})

describe('multi-year spreadsheets', () => {
  it('«Показатель ; 2024 ; 2025» gives one field per year; the metric takes the latest year', async () => {
    const csv = 'Показатель;2024;2025\nВыручка;60 000 000;72 000 000\nСебестоимость;35 000 000;40 000 000\n'
    const out = await runDocumentPipeline({
      documentId: 'pl', docType: 'pl_report', fileName: 'pl.csv', buffer: Buffer.from(csv), kind: 'csv', mime: 'text/csv',
      llm: null, aiBudgetLeft: () => false, deadlineAt: Date.now() + 60_000,
    })
    expect(out.status).toBe('parsed')
    if (out.status !== 'parsed') return
    const revenue = out.payload.fields.filter((x) => x.key === 'revenue').map((x) => [x.value, x.period])
    expect(revenue).toEqual([[60_000_000, '2024'], [72_000_000, '2025']])
    const r = v('biz.finansy.vyruchka_god', ctx([{ id: 'pl', docType: 'pl_report', parsedData: out.payload, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z' }]))
    expect(r.numeric).toBe(72_000_000)
    expect(r.considered.find((a) => a.status === 'hit')?.period).toMatchObject({ year: 2025, basis: 'field' })
  })
})
