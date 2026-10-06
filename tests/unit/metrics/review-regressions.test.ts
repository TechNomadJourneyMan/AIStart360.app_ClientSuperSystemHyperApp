/**
 * Regressions from the independent review of the metrics overhaul (W4).
 * One describe per finding; each case failed on the code before the fix.
 *
 *   #4  time nouns are checked against the metric's unit; «в день» is a rate
 *   #5  an undated document never beats a dated (rescaled) one for a flow metric
 *   #6  file names: an export date is no period; «2025_03», «Q1-Q3», «9М»
 *   #7  LTV from churn needs the churn's own period (annualised by compounding)
 *   #8  a % value ≤ 1 becomes a share only when the field / column says so
 *   #10 derived client-base facts from OCR text: confidence cap 0.7 + OCR provenance
 *   #11 separators: «1,500 млн» = 1.5 млн, «1.200» = «1,200» = 1200
 */
import { describe, expect, it } from 'vitest'
import { resolveMetric } from '@/lib/metrics/resolver'
import { getMetricById } from '@/lib/metrics/registry'
import { resolveDocumentSource, type MetricShape } from '@/lib/metrics/source-adapters'
import { coerceNumber, parseNumber } from '@/lib/metrics/numbers'
import { parsePeriodLabel, periodFromFileName } from '@/lib/metrics/period'
import type { MetricSource } from '@/lib/metrics/format'
import type { ParsedDataShape, ResolverContext, ResolverDocument } from '@/lib/metrics/types'

type Field = NonNullable<ParsedDataShape['fields']>[number]

function doc(id: string, docType: string, fields: Field[], extra: Partial<ResolverDocument> = {}): ResolverDocument {
  return { id, docType, parsedData: { fields }, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', ...extra }
}
function ctx(documents: ResolverDocument[], surveyAnswers: Record<string, unknown> = {}): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers, documents, now: new Date('2026-10-06T00:00:00Z') }
}
const v = (id: string, c: ResolverContext) => resolveMetric(id, c, { entry: getMetricById(id)! })
const hit = (id: string, c: ResolverContext) => v(id, c).considered.find((a) => a.status === 'hit')
const f = (key: string, value: unknown, extra: Partial<Field> = {}): Field => ({ key, label: key, value, ...extra })

/** One document source against a metric shape (unit / period) — the adapter itself. */
function docValue(value: unknown, shape: Partial<MetricShape>, extra: Partial<Field> = {}): number | null {
  const source: MetricSource = { type: 'document', field: 'x' }
  const a = resolveDocumentSource(source, ctx([doc('d', 'other', [f('x', value, extra)])]), 'm', { id: 'm', unit: '', ...shape })
  return a.status === 'hit' ? (a.numeric ?? null) : null
}

describe('#4 time units are checked against the metric unit', () => {
  it('a document duration is converted to the metric unit or refused', () => {
    expect(docValue('3 месяца', { unit: 'days' })).toBe(90)
    expect(docValue(3, { unit: 'days' }, { unit: 'мес' })).toBe(90)
    expect(docValue('2 недели', { unit: 'days' })).toBe(14)
    expect(docValue('45 мин', { unit: 'days' })).toBeNull() // a sub-day duration is no number of days
    expect(docValue('2 часа', { unit: 'мин' })).toBe(120)
    expect(docValue('45 дней', { unit: 'мес' })).toBe(1.5)
    expect(docValue('30 дней', { unit: '₸' })).toBeNull() // a duration is no money
    expect(docValue('12 дней', { unit: 'count', period: 'month' })).toBeNull()
  })

  it('survey: «3 месяца» for the deal cycle (days) → 90, «45 мин» → no value', () => {
    expect(v('biz.prodazhi.tsikl_zakrytiya_sdelki', ctx([], { s3_deal_cycle_days: '3 месяца' })).numeric).toBe(90)
    expect(v('biz.prodazhi.tsikl_zakrytiya_sdelki', ctx([], { s3_deal_cycle_days: '45 мин' })).numeric).toBeNull()
    expect(v('biz.prodazhi.tsikl_zakrytiya_sdelki', ctx([], { s3_deal_cycle_days: '21 день' })).numeric).toBe(21)
    expect(v('biz.prodazhi.tsikl_zakrytiya_sdelki', ctx([], { s3_deal_cycle_days: '30 дней в месяц' })).numeric).toBeNull()
  })

  it('survey: «20 в день» for a monthly metric → ×30, «50 000 в день» for yearly revenue → ×365, with provenance', () => {
    const leads = ctx([], { s7_leads_per_month: '20 в день' })
    expect(v('biz.marketing.lidov_v_mes', leads).numeric).toBe(600)
    expect(hit('biz.marketing.lidov_v_mes', leads)?.period).toMatchObject({ source: 'day', target: 'month', factor: 30, basis: 'answer' })
    const rev = ctx([], { s1_current_revenue_year: '50 000 в день' })
    expect(v('biz.finansy.vyruchka_god', rev).numeric).toBe(18_250_000)
    expect(hit('biz.finansy.vyruchka_god', rev)?.period).toMatchObject({ source: 'day', target: 'year', factor: 365 })
    expect(hit('biz.finansy.vyruchka_god', rev)?.reason).toMatch(/day → year ×365/)
  })

  it('conflicting or unusable time words → no number', () => {
    // a duration with a rate is no value for a duration metric nor for a flow metric
    expect(docValue('3 месяца в год', { unit: 'days' })).toBeNull()
    expect(docValue('3 месяца в год', { unit: 'count', period: 'year' })).toBeNull()
    expect(parseNumber('3 дня 2 недели')).toBeNull() // two numbers
    expect(parseNumber('5 млн месяц в год')).toBeNull()
    expect(parseNumber('5 млн в месяц в год')).toBeNull()
    expect(parseNumber('100 лидов в час')).toBeNull()
    expect(parseNumber('3 месяца')).toMatchObject({ value: 3, duration: 'month', period: null })
    expect(parseNumber('20 в день')).toMatchObject({ value: 20, period: 'day', duration: null })
    expect(parseNumber('8 часов в день')).toMatchObject({ value: 8, duration: 'hour', period: 'day' })
    expect(parseNumber('500 000 тг/мес')).toMatchObject({ value: 500_000, period: 'month', duration: null })
    expect(parseNumber('2015 год')).toMatchObject({ value: 2015, duration: null })
  })
})

describe('#5 unknown period ranks after any detected period (flow metrics)', () => {
  it('ДДС.xlsx 12 000 000 (undated) vs «ДДС Q3 2026.xlsx» 3 000 000 → 1 000 000 a month', () => {
    const undated = doc('dds', 'pl_report', [f('cash_flow', 12_000_000)], { fileName: 'ДДС.xlsx', uploadedAt: '2026-10-05T00:00:00Z' })
    const q3 = doc('dds-q3', 'pl_report', [f('cash_flow', 3_000_000)], { fileName: 'ДДС Q3 2026.xlsx', uploadedAt: '2026-10-01T00:00:00Z' })
    const r = v('biz.finansy.cash_flow_mes', ctx([undated, q3]))
    expect(r.numeric).toBe(1_000_000)
    expect(hit('biz.finansy.cash_flow_mes', ctx([undated, q3]))?.document?.document_id).toBe('dds-q3')
    // An undated value is still used when it is the only one.
    expect(v('biz.finansy.cash_flow_mes', ctx([undated])).numeric).toBe(12_000_000)
  })
})

describe('#6 periods from file names', () => {
  it('an export date is no period; «2025_03» is March; Q-ranges and «9М» are 9 months', () => {
    expect(periodFromFileName('Лиды 15.09.2026.xlsx')).toBeNull()
    expect(periodFromFileName('Выгрузка amoCRM 2026-09-15.csv')).toBeNull()
    expect(periodFromFileName('Продажи_2025_03.xlsx')).toMatchObject({ months: 1, year: 2025, endMonth: 3 })
    expect(periodFromFileName('Отчёт Q1-Q3 2025.xlsx')).toMatchObject({ months: 9, year: 2025, endMonth: 9 })
    expect(periodFromFileName('P&L 9М 2025.xlsx')).toMatchObject({ months: 9, year: 2025 })
    expect(periodFromFileName('P&L 9 мес 2025.xlsx')).toMatchObject({ months: 9, year: 2025 })
    expect(periodFromFileName('ДДС Q3 2026.xlsx')).toMatchObject({ months: 3, year: 2026, quarter: 'Q3' })
    expect(periodFromFileName('P&L 2025.csv')).toMatchObject({ months: 12, year: 2025 })
    expect(periodFromFileName('отчёт за месяц.xlsx')).toBeNull() // no year: not a clear period
    expect(parsePeriodLabel('Q1-Q3 2025')).toMatchObject({ months: 9 })
    expect(parsePeriodLabel('01.01.2025–31.12.2025')).toMatchObject({ months: 12, year: 2025 })
    expect(parsePeriodLabel('15.09.2026')).toBeNull()
  })

  it('the resolver does not rescale a value by an export date in the file name', () => {
    const export15 = doc('l', 'crm_export', [f('leads_count', 3600)], { fileName: 'Лиды 15.09.2026.xlsx' })
    expect(v('biz.marketing.lidov_v_mes', ctx([export15])).numeric).toBe(3600) // not ÷12 as «a 2026 year»
    const march = doc('m', 'crm_export', [f('leads_count', 300)], { fileName: 'Продажи_2025_03.xlsx' })
    expect(v('biz.marketing.lidov_v_mes', ctx([march])).numeric).toBe(300) // a month, not a year ÷12
  })
})

describe('#7 LTV from churn needs the churn period', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    client_id: `c${i}`, last_purchase_date: i < 15 ? '2025-11-01' : '2024-02-01', purchase_count: 1,
  }))
  const base = (churn: Field, extra: Partial<ResolverDocument> = {}) =>
    ctx([{ ...doc('cb', 'client_base', [churn], extra), parsedData: { fields: [churn], client_rows: rows } }], { s1_current_revenue_year: 60_000_000 })

  it('an undated churn gives no LTV (never assumed yearly)', () => {
    const c = base(f('churn_rate', 20))
    expect(v('biz.klienty.arpu', c).numeric).toBe(4_000_000)
    expect(v('goal.02.churn_rate', c).numeric).toBe(20) // the metric itself keeps the stated value
    expect(v('goal.04.ltv', c).numeric).toBeNull()
  })

  it('a monthly churn is annualised by compounding, with provenance', () => {
    const c = base(f('churn_rate', 5, { label: 'Отток клиентов в месяц, %' }))
    const yearly = (1 - Math.pow(0.95, 12)) * 100
    expect(v('base.churn_rate_year', c).numeric).toBeCloseTo(yearly, 1)
    expect(hit('base.churn_rate_year', c)?.document?.unit_conversion).toMatch(/1 − \(1 − 5%\)\^12/)
    expect(v('goal.04.ltv', c).numeric).toBeCloseTo(4_000_000 / (Math.round(yearly * 100) / 10_000), -1)
  })

  it('a churn of a yearly document is used as is', () => {
    const c = base(f('churn_rate', 20), { periodYear: 2025 })
    expect(v('goal.04.ltv', c).numeric).toBe(20_000_000)
  })
})

describe('#8 fractions in percent metrics', () => {
  it('churn 1 stays 1 %, a lone «0,8» conversion stays 0.8 %', () => {
    expect(v('goal.02.churn_rate', ctx([doc('c', 'client_base', [f('churn_rate', 1)])])).numeric).toBe(1)
    expect(v('biz.marketing.konversiya_lid_klient', ctx([doc('k', 'crm_export', [f('conversion_rate', '0,8', { label: 'Конверсия' })])])).numeric).toBe(0.8)
  })

  it('converts when the field says доля / share / коэффициент, or the percent column is fractional', () => {
    expect(v('biz.marketing.konversiya_lid_klient', ctx([doc('k', 'crm_export', [f('conversion_rate', 0.08, { label: 'Конверсия (доля)' })])])).numeric).toBe(8)
    const column = doc('pl', 'pl_report', [f('revenue', 72_000_000), f('gross_margin', 0.34), f('churn_rate', 0.05)])
    expect(v('biz.finansy.valovaya_marzha', ctx([column])).numeric).toBe(34)
    // exactly 1 is never converted, even in a fractional column
    const withOne = doc('pl', 'pl_report', [f('gross_margin', 0.34), f('churn_rate', 1)])
    expect(v('goal.02.churn_rate', ctx([{ ...withOne, docType: 'client_base' }])).numeric).toBe(1)
  })
})

describe('#10 client-base facts from OCR text', () => {
  it('active customers / repeat share of an OCR\'d registry: confidence ≤ 0.7 and OCR provenance', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ client_id: `c${i}`, last_purchase_date: '2025-11-01', purchase_count: i < 6 ? 2 : 1 }))
    const scan: ResolverDocument = {
      ...doc('scan', 'client_base', []),
      parsedData: { fields: [], client_rows: rows, source: { kind: 'image', ocr: { engine: 'tesseract', mean_confidence: 78.4 } } },
    }
    for (const id of ['biz.klienty.aktivnykh_klientov', 'goal.02.repeat_purchase_rate']) {
      const r = v(id, ctx([scan]))
      expect(r.confidence, id).toBeLessThanOrEqual(0.7)
      expect(hit(id, ctx([scan]))?.document, id).toMatchObject({ ocr: true, ocr_engine: 'tesseract', ocr_page_confidence: 78 })
    }
    const typed: ResolverDocument = { ...scan, parsedData: { fields: [], client_rows: rows } }
    expect(v('biz.klienty.aktivnykh_klientov', ctx([typed])).confidence).toBe(0.8)
  })
})

describe('#11 number separators', () => {
  it.each([
    ['1,500 млн', 1_500_000],
    ['1.500 млн', 1_500_000],
    ['2,5 тыс', 2_500],
    ['84.2 млн', 84_200_000],
    ['1.200', 1_200],
    ['1,200', 1_200],
    ['1.200 тг', 1_200],
    ['12.345', 12_345],
    ['1,234,567', 1_234_567],
    ['1.234.567', 1_234_567],
    ['1 200,5', 1_200.5],
    ['1.5', 1.5],
    ['0,344', 0.344],
    ['0.344', 0.344],
    ['1234.567', 1_234.567],
  ])('%s → %d', (raw, expected) => {
    expect(coerceNumber(raw)).toBe(expected)
  })

  it('a percent sign makes a single separator decimal', () => {
    expect(parseNumber('12.345%')).toMatchObject({ value: 12.345, percent: true })
    expect(parseNumber('1,5%')).toMatchObject({ value: 1.5, percent: true })
  })
})
