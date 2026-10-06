/**
 * Golden end-to-end test (W4): questionnaire answers + a P&L CSV + an OCR'd
 * scan go through the real document pipeline and the resolver; the resulting
 * public.metrics rows are then read by every surface through its real code:
 *
 *   Metrics catalog / KPI tab   GET /api/v1/metrics/catalog
 *   dashboard heroes            GET /api/v1/metrics (summaries)
 *   Point A                     resolved engine inputs (rows and live values)
 *   Point B                     calculatePointBV2 options from the same rows
 *   Point A V3 blocks           GET /api/v1/point-a/v3 (loadCompanyMetrics)
 *
 * and every surface must show the same number for the same metric.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDocumentPipeline } from '@/lib/documents/pipeline'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { toMaterializedRow } from '@/lib/metrics/materialize'
import { companyMetricsFromRows } from '@/lib/metrics/company-metrics'
import { resolvedInputsFromMetricRows, resolvedInputsFromValues } from '@/lib/point-a/resolved-inputs'
import { calculatePointA } from '@/lib/point-a-engine'
import { calculatePointBV2 } from '@/lib/point-b/engine'
import { pointBOptionsFromMetrics } from '@/lib/point-b/metrics'
import type { MaterializedRow, ResolverDocument } from '@/lib/metrics/types'

// ── Supabase / tenancy mocks for the two API routes ──────────────────────────
let metricRows: Array<MaterializedRow & { recorded_at: string; period_month: null }> = []
type Result = { data: unknown; error: null }
function stub(result: Result) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not']) b[m] = () => b
  b.maybeSingle = () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null })
  b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return b
}
const supabaseMock = {
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })) },
  from: vi.fn((table: string) => {
    if (table === 'metrics') return stub({ data: metricRows, error: null })
    if (table === 'companies') return stub({ data: { id: 'co-1', user_id: 'owner-1', target_revenue_12m_kzt: null }, error: null })
    // The owner's questionnaire as stored (V3 reads it for its own inputs).
    if (table === 'survey_answers') return stub({ data: Object.entries(SURVEY).map(([question_key, value]) => ({ question_key, answer: { value } })), error: null })
    return stub({ data: [], error: null })
  }),
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseMock) }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: vi.fn(async () => ({ ok: true, tenant: { userId: 'owner-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } })),
  tenantErrorMessage: () => 'Нет доступа',
}))

import { GET as catalogGET } from '@/app/api/v1/metrics/catalog/route'
import { GET as metricsGET } from '@/app/api/v1/metrics/route'
import { GET as pointAV3GET } from '@/app/api/v1/point-a/v3/route'
import type { PointAV3 } from '@/types/point-a-v3'

// ── Inputs ───────────────────────────────────────────────────────────────────
const SURVEY: Record<string, unknown> = {
  s1_current_revenue_month: 5_500_000,
  s1_current_revenue_year: 66_000_000,
  s1_employee_count: 24,
  s3_deal_cycle_days: 21,
  s3_deals_2025: 420,
  s3_rejections_2025: 180,
  s5n_funnel_lead_to_sale: 8,
  s5n_will_return_nps: '8 из 10',
  s7_leads_per_month: 300,
  s7_nps_score: 42,
  s9n_expense_cogs: '30 млн',
  s8n_metrics_table: [
    { metric_name: 'Сумма продаж', y2025: 64_000_000 },
    { metric_name: 'Кол-во новых продаж', y2025: 300 },
    { metric_name: 'Кол-во повторных', y2025: 100 },
  ],
}

const PL_CSV = [
  'Показатель;Значение',
  'Выручка;72 000 000',
  'Себестоимость;40 000 000',
  'Валовая маржа (доля);0,44',
  'Операционные расходы;18 000 000',
  'Чистая прибыль;9 500 000',
].join('\n')

const SCAN_TEXT = 'Маркетинговый отчёт за 1 квартал 2025 года\nCAC: 18 500 тг\nLTV: 390 000 тг\n'

async function buildDocuments(): Promise<ResolverDocument[]> {
  const common = { llm: null, aiBudgetLeft: () => false, deadlineAt: Date.now() + 60_000 }
  const pl = await runDocumentPipeline({
    ...common, documentId: 'doc-pl', docType: 'financial_report', fileName: 'P&L 2025.csv',
    buffer: Buffer.from(PL_CSV, 'utf8'), kind: 'csv', mime: 'text/csv',
  })
  const scan = await runDocumentPipeline({
    ...common, documentId: 'doc-scan', docType: 'marketing_report', fileName: 'scan.png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), kind: 'image', mime: 'image/png',
    ocr: async () => ({ ok: true, pages: [{ page: 1, text: SCAN_TEXT, confidence: 81, engine: 'tesseract' }], totalPages: 1, engine: 'tesseract', meanConfidence: 81 }),
  })
  if (pl.status !== 'parsed' || scan.status !== 'parsed') throw new Error(`pipeline: ${pl.status} / ${scan.status}`)
  return [
    { id: 'doc-pl', docType: 'financial_report', parsedData: pl.payload, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z', fileName: 'P&L 2025.csv' },
    { id: 'doc-scan', docType: 'marketing_report', parsedData: scan.payload, periodYear: null, periodQuarter: null, uploadedAt: '2026-10-02T00:00:00Z', fileName: 'scan.png' },
  ]
}

const KEY_METRICS = {
  revenue: 'biz.finansy.vyruchka_god',
  margin: 'biz.finansy.valovaya_marzha',
  cac: 'biz.marketing.cac',
  ltv: 'goal.04.ltv',
  ltvCac: 'biz.marketing.ltv_cac',
  dealCycle: 'biz.prodazhi.tsikl_zakrytiya_sdelki',
  leads: 'biz.marketing.lidov_v_mes',
  conversion: 'biz.marketing.konversiya_lid_klient',
  repeat: 'goal.02.repeat_purchase_rate',
  lossRate: 'goal.06.loss_rate',
  avgCheck: 'biz.prodazhi.sredniy_chek',
} as const

describe('golden: survey + P&L + OCR scan → identical values on every surface', () => {
  let values: ReturnType<typeof resolveAllMetrics>

  beforeEach(async () => {
    const documents = await buildDocuments()
    values = resolveAllMetrics({ companyId: 'co-1', userId: 'owner-1', surveyAnswers: SURVEY, documents, now: new Date('2026-10-06T08:00:00Z') })
    metricRows = values
      .filter((v) => v.picked !== null && v.numeric !== null)
      .map((v) => ({ ...toMaterializedRow(v, 'co-1'), recorded_at: v.computedAt, period_month: null }))
  })

  it('the resolver reads each source with its meaning', () => {
    const byId = new Map(values.map((v) => [v.metricId, v]))
    expect(byId.get(KEY_METRICS.revenue)).toMatchObject({ numeric: 72_000_000, picked: { type: 'document' } }) // P&L beats the survey
    expect(byId.get(KEY_METRICS.margin)?.numeric).toBe(44) // «(доля) 0,44» → 44 %
    expect(byId.get(KEY_METRICS.cac)).toMatchObject({ numeric: 18_500, picked: { type: 'document' } }) // OCR scan
    expect(byId.get(KEY_METRICS.cac)?.confidence).toBeLessThanOrEqual(0.7)
    expect(byId.get(KEY_METRICS.ltvCac)?.numeric).toBeCloseTo(390_000 / 18_500, 3)
    expect(byId.get(KEY_METRICS.repeat)?.numeric).toBe(25)
    expect(byId.get(KEY_METRICS.lossRate)?.numeric).toBe(30)
    expect(byId.get('biz.klienty.churn_rate')?.numeric).toBeNull() // «8 из 10» is no churn of 810 %
  })

  it('catalog, KPI tab, dashboard summary, Point A inputs and Point B agree', async () => {
    const expected = Object.fromEntries(Object.values(KEY_METRICS).map((id) => [id, values.find((v) => v.metricId === id)?.numeric ?? null]))
    for (const [id, n] of Object.entries(expected)) expect(n, id).not.toBeNull()

    // Metrics catalog (and the KPI / Goals tabs, which read the same route per namespace).
    const catRes = await catalogGET({ url: 'http://localhost/api/v1/metrics/catalog?pageSize=200' } as never)
    const cat = (await (catRes as Response).json()) as { data: { items: Array<{ id: string; value: number | null; unit: string }> } }
    const catalog = new Map(cat.data.items.map((i) => [i.id, i.value]))
    const kpiRes = await catalogGET({ url: 'http://localhost/api/v1/metrics/catalog?namespace=kpi&pageSize=200' } as never)
    const kpi = (await (kpiRes as Response).json()) as { data: { items: Array<{ id: string; value: number | null }> } }
    expect(kpi.data.items.find((i) => i.id === 'kpi.obschaya_vyruchka_god')?.value).toBe(expected[KEY_METRICS.revenue])

    // Dashboard heroes.
    const sumRes = await metricsGET(new Request(`http://localhost/api/v1/metrics?keys=${Object.values(KEY_METRICS).join(',')}`))
    const sum = (await (sumRes as Response).json()) as { data: Array<{ id: string; rawValue: number }> }
    const summary = new Map(sum.data.map((s) => [s.id, s.rawValue]))

    // Point A: engine inputs from the rows (recalculation) and from live values (aggregator).
    const fromRows = resolvedInputsFromMetricRows(metricRows)
    const fromValues = resolvedInputsFromValues(values)
    expect(fromRows).toEqual(fromValues)

    // Point B: options from the same rows.
    const opts = pointBOptionsFromMetrics(companyMetricsFromRows(metricRows))
    const pointB = calculatePointBV2(calculatePointA(SURVEY, fromRows), SURVEY, { ...opts, goal12mYear: 100_000_000 })
    const lever = (key: string) => pointB.levers.find((l) => l.key === key)?.current

    for (const id of Object.values(KEY_METRICS)) {
      expect(catalog.get(id), `catalog ${id}`).toBe(expected[id])
      expect(summary.get(id), `dashboard ${id}`).toBe(expected[id])
    }
    expect(fromRows).toMatchObject({
      grossMargin: expected[KEY_METRICS.margin],
      cac: expected[KEY_METRICS.cac],
      ltv: expected[KEY_METRICS.ltv],
      ltvCacRatio: expected[KEY_METRICS.ltvCac],
      dealCycleDays: expected[KEY_METRICS.dealCycle],
      repeatSharePct: expected[KEY_METRICS.repeat],
      refusalPct: expected[KEY_METRICS.lossRate],
    })
    expect(pointB.goals.current_revenue_year).toBe(expected[KEY_METRICS.revenue])
    expect(pointB.gap.find((g) => g.horizon === '12m')?.current_revenue).toBe(expected[KEY_METRICS.revenue])
    expect(lever('margin')).toBe(expected[KEY_METRICS.margin])
    expect(lever('cac')).toBe(expected[KEY_METRICS.cac])
    expect(lever('leads')).toBe(expected[KEY_METRICS.leads])
    expect(lever('conversion')).toBe(expected[KEY_METRICS.conversion])
    expect(lever('repeat')).toBe(expected[KEY_METRICS.repeat])
    expect(lever('avg_check')).toBe(expected[KEY_METRICS.avgCheck])
  })

  it('Point A V3 blocks show the same numbers (loadCompanyMetrics, not a survey-only resolve)', async () => {
    const expected = (id: string) => values.find((v) => v.metricId === id)?.numeric ?? null
    const res = await pointAV3GET()
    const body = (await (res as Response).json()) as { ok: boolean; data: PointAV3 }
    expect(body.ok).toBe(true)
    const b = body.data.blocks
    expect(b.sales.Rev.value).toBe(expected(KEY_METRICS.revenue)) // the P&L, not the survey's 66 M
    expect(b.sales.AOV.value).toBe(expected(KEY_METRICS.avgCheck))
    expect(b.client.LTV.value).toBe(expected(KEY_METRICS.ltv))
    expect(b.client.CAC.value).toBe(expected(KEY_METRICS.cac)) // OCR scan
    expect(b.finance.GrossMargin.value).toBe(expected(KEY_METRICS.margin))
  })
})
