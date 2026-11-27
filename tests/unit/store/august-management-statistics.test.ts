import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import {
  buildStoreAnalytics,
  type StoreFinancialAnalyticsPeriod,
} from '@/lib/store/analytics'
import { parseStoreImport } from '@/lib/store/import/parser'
import {
  buildStorePublishPayload,
  type StorePublishManagementPeriodRow,
} from '@/lib/store/import/publication'

const AUGUST_PUBLISHED_AT = '2026-08-31T12:00:00.000Z'

function managementWorkbookForAugust(): Buffer {
  const base = XLSX.utils.aoa_to_sheet([
    ['SYNTHETIC · ДИНАМИКА ПРОДАЖ ПО МЕСЯЦАМ · 2026'],
    [],
    ['Год', 'Месяц', 'Выручка', 'Закуп (себест.)', 'Вал. прибыль', 'Маржа', 'Δ м/м', 'Примечание'],
    [2026, 'Август', 31_000_000, 18_000_000, null, null, null, null],
  ])
  const pnl = XLSX.utils.aoa_to_sheet([
    ['SYNTHETIC · ПОЛНЫЙ P&L · АВГУСТ 2026'],
    [],
    ['Месяц', 'Выручка', 'Вал. прибыль', 'Расходы периода', 'в т.ч. бонусы', 'в т.ч. списание'],
    ['Август', 31_000_000, 13_000_000, 9_500_000, 1_000_000, 500_000],
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, base, 'Динамика по месяцам')
  XLSX.utils.book_append_sheet(workbook, pnl, 'P&L 2026 (август)')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function existingFinancialPeriod(
  month: string,
  revenue: number,
  costAmount: number,
  reportedGrossProfit: number,
  periodExpenses: number,
  bonuses: number,
  writeOffs: number,
): StoreFinancialAnalyticsPeriod {
  return {
    month,
    revenue,
    costAmount,
    reportedGrossProfit,
    periodExpenses,
    bonuses,
    writeOffs,
    ebitda: Math.round((reportedGrossProfit - periodExpenses) * 100) / 100,
    completeness: 'complete',
    note: null,
    scopeKey: `month:${month}`,
    sourceSheet: 'P&L 2026 (май–июль)',
    publishedAt: '2026-08-24T10:00:00.000Z',
  }
}

function financialPeriodFromPublishedRow(
  row: StorePublishManagementPeriodRow,
): StoreFinancialAnalyticsPeriod {
  return {
    month: row.periodStart.slice(0, 7),
    revenue: row.revenue,
    costAmount: row.costAmount,
    reportedGrossProfit: row.reportedGrossProfit,
    periodExpenses: row.periodExpenses,
    bonuses: row.bonuses,
    writeOffs: row.writeOffs,
    ebitda: row.ebitda,
    completeness: row.completeness,
    note: row.note,
    scopeKey: row.scopeKey,
    sourceSheet: row.sourceSheet,
    publishedAt: AUGUST_PUBLISHED_AT,
  }
}

describe('Store August management statistics regression', () => {
  it('adds the parsed complete August period to current/latest statistics without losing prior history or P&L', () => {
    const preview = parseStoreImport(
      managementWorkbookForAugust(),
      'HONOR-management-2026-08.xlsx',
      { now: new Date('2026-09-01T00:00:00+05:00') },
    )
    const payload = buildStorePublishPayload(preview)
    const [publishedAugust] = payload.rows.filter(
      (row): row is StorePublishManagementPeriodRow => 'granularity' in row,
    )

    expect(preview.detectedKinds).toEqual(['management_period'])
    expect(preview.summary).toMatchObject({ acceptedRows: 1, quarantinedRows: 0 })
    expect(publishedAugust).toMatchObject({
      scopeKey: 'month:2026-08',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      completeness: 'complete',
      revenue: 31_000_000,
      costAmount: 18_000_000,
      reportedGrossProfit: 13_000_000,
      periodExpenses: 9_500_000,
      bonuses: 1_000_000,
      writeOffs: 500_000,
      ebitda: 3_500_000,
    })

    const priorPeriods = [
      existingFinancialPeriod('2026-05', 100000, 60000, 40000, 55000.2, 1500, 1200),
      existingFinancialPeriod('2026-06', 120000, 70000, 49999.71, 65000, 2000, 1500),
      existingFinancialPeriod('2026-07', 140000, 90000, 49999.54, 65000.45, 2500, 900),
    ]
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-31T07:00:00.000Z'),
      operationalPeriods: [],
      financialPeriods: [...priorPeriods, financialPeriodFromPublishedRow(publishedAugust)],
      financialSchemaAvailable: true,
      myHonorFacts: [],
      myHonorSyncedAt: null,
    })

    expect(analytics.history.map((period) => period.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ])
    expect(analytics.pnl.periods.map((period) => period.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ])
    expect(analytics.history.at(-1)).toMatchObject({
      month: '2026-08',
      coverage: 'complete',
      source: 'financial_report',
      metrics: {
        revenue: 31_000_000,
        cost: 18_000_000,
        grossProfit: 13_000_000,
        grossMarginPct: 41.94,
      },
    })
    expect(analytics.pnl.periods.at(-1)).toMatchObject({
      month: '2026-08',
      coverage: 'complete',
      revenue: 31_000_000,
      grossProfit: 13_000_000,
      periodExpenses: 9_500_000,
      ebitda: 3_500_000,
    })
    for (const window of [analytics.windows.monthToDate, analytics.windows.latestPublished]) {
      expect(window).toMatchObject({
        period: { from: '2026-08-01', to: '2026-08-31' },
        coverage: 'complete',
        source: 'financial_report',
        scopeKey: 'month:2026-08',
        publishedAt: AUGUST_PUBLISHED_AT,
        metrics: {
          revenue: 31_000_000,
          cost: 18_000_000,
          grossProfit: 13_000_000,
          grossMarginPct: 41.94,
        },
      })
    }
    expect(analytics.freshness.sales).toMatchObject({
      coverage: 'complete',
      lastFactAt: '2026-08-31',
      publishedAt: AUGUST_PUBLISHED_AT,
    })
  })

  it('publishes an in-progress August report as provisional and keeps the uploaded values visible', () => {
    const preview = parseStoreImport(
      managementWorkbookForAugust(),
      'HONOR-management-2026-08-MTD.xlsx',
      { now: new Date('2026-08-26T12:00:00+05:00') },
    )
    const payload = buildStorePublishPayload(preview)
    const [publishedAugust] = payload.rows.filter(
      (row): row is StorePublishManagementPeriodRow => 'granularity' in row,
    )

    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'management_period_provisional',
      severity: 'warning',
    }))
    expect(publishedAugust).toMatchObject({
      scopeKey: 'month:2026-08',
      completeness: 'provisional',
      revenue: 31_000_000,
      ebitda: 3_500_000,
    })

    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-26T12:00:00+05:00'),
      operationalPeriods: [],
      financialPeriods: [financialPeriodFromPublishedRow(publishedAugust)],
      financialSchemaAvailable: true,
      myHonorFacts: [],
      myHonorSyncedAt: null,
    })
    expect(analytics.history.at(-1)).toMatchObject({
      month: '2026-08',
      coverage: 'partial',
      metrics: { revenue: 31_000_000 },
    })
    expect(analytics.pnl.periods.at(-1)).toMatchObject({
      month: '2026-08',
      coverage: 'partial',
      revenue: 31_000_000,
      ebitda: 3_500_000,
    })
  })
})
