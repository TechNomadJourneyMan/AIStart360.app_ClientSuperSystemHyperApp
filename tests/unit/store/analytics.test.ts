import { describe, expect, it } from 'vitest'
import {
  buildStoreAnalytics,
  type BuildStoreAnalyticsInput,
  type StoreFinancialAnalyticsPeriod,
} from '@/lib/store/analytics'
import type { StoreSalesFact } from '@/lib/store/types'

function salesFact(input: Partial<StoreSalesFact> & Pick<StoreSalesFact, 'id' | 'occurredOn'>): StoreSalesFact {
  return {
    channel: 'Магазин',
    warehouseName: 'Астана',
    productName: 'HONOR',
    sku: 'HONOR-1',
    quantity: 1,
    listAmount: 100,
    netRevenue: 100,
    costAmount: 60,
    discountAmount: 0,
    ...input,
  }
}

function financial(
  month: string,
  revenue: number,
  costAmount: number,
  overrides: Partial<StoreFinancialAnalyticsPeriod> = {},
): StoreFinancialAnalyticsPeriod {
  return {
    month,
    revenue,
    costAmount,
    reportedGrossProfit: null,
    periodExpenses: null,
    bonuses: null,
    writeOffs: null,
    ebitda: null,
    completeness: 'complete',
    note: null,
    scopeKey: `month:${month}`,
    sourceSheet: 'Управленческий отчёт',
    publishedAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  }
}

const julyFacts: StoreSalesFact[] = [
  salesFact({
    id: 'july-sales',
    occurredOn: '2026-07-15',
    quantity: 1_333,
    listAmount: 42_200_000,
    netRevenue: 28_130_000,
    costAmount: 17_190_000,
    discountAmount: 14_070_000,
  }),
  salesFact({
    id: 'july-returns',
    occurredOn: '2026-07-22',
    quantity: -9,
    listAmount: -117_380,
    netRevenue: -76_747,
    costAmount: -50_025.54,
    discountAmount: -40_633,
  }),
]

describe('Store analytics projection', () => {
  it('keeps today and August MTD honest while reconciling the exact July golden', () => {
    const input: BuildStoreAnalyticsInput = {
      now: new Date('2026-08-25T06:00:00.000Z'),
      operationalPeriods: [{
        scopeKey: 'month:2026-07',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        publishedAt: '2026-08-12T10:00:00.000Z',
        facts: julyFacts,
      }],
      myHonorFacts: [],
      myHonorSyncedAt: '2026-07-29T10:00:00.000Z',
      financialSchemaAvailable: false,
    }
    const snapshot = JSON.stringify(input)

    const analytics = buildStoreAnalytics(input)

    expect(JSON.stringify(input)).toBe(snapshot)
    expect(analytics.timezone).toBe('Asia/Almaty')
    expect(analytics.currentDate).toBe('2026-08-25')
    expect(analytics.windows.today.coverage).toBe('stale')
    expect(analytics.windows.today.metrics.revenue).toBeNull()
    expect(analytics.windows.monthToDate.coverage).toBe('stale')
    expect(analytics.windows.monthToDate.metrics.revenue).toBeNull()
    expect(analytics.windows.latestPublished).toMatchObject({
      coverage: 'complete',
      source: 'operational',
      scopeKey: 'month:2026-07',
      metrics: {
        revenue: 28_053_253,
        cost: 17_139_974.46,
        grossProfit: 10_913_278.54,
        grossMarginPct: 38.9,
        listRevenue: 42_082_620,
        discount: 14_029_367,
        discountRatePct: 33.34,
        units: 1_324,
        returns: 9,
      },
    })
  })

  it('uses operational, then financial, then MyHonor without double counting a month', () => {
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-25T06:00:00.000Z'),
      operationalPeriods: [{
        scopeKey: 'month:2026-07',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        publishedAt: '2026-08-12T10:00:00.000Z',
        facts: julyFacts,
      }],
      financialPeriods: [
        financial('2026-06', 1_000, 600),
        financial('2026-07', 999_999_999, 1),
      ],
      financialSchemaAvailable: true,
      myHonorFacts: [
        salesFact({ id: 'myhonor-june', occurredOn: '2026-06-15', netRevenue: 90_000 }),
        salesFact({ id: 'myhonor-july', occurredOn: '2026-07-15', netRevenue: 80_000 }),
        salesFact({ id: 'myhonor-may', occurredOn: '2026-05-15', netRevenue: 700 }),
        salesFact({ id: 'myhonor-august', occurredOn: '2026-08-01', netRevenue: 600 }),
      ],
      myHonorSyncedAt: '2026-07-29T10:00:00.000Z',
    })

    const june = analytics.history.find((period) => period.month === '2026-06')
    const july = analytics.history.find((period) => period.month === '2026-07')
    const may = analytics.history.find((period) => period.month === '2026-05')
    expect(june).toMatchObject({ source: 'financial_report', metrics: { revenue: 1_000 } })
    expect(july).toMatchObject({ source: 'operational', metrics: { revenue: 28_053_253 } })
    expect(may).toMatchObject({ source: 'myhonor', coverage: 'partial', metrics: { revenue: 700 } })
    expect(analytics.windows.latestPublished.metrics.revenue).toBe(28_053_253)
  })

  it('marks a current MyHonor event partial because observed orders have no completeness watermark', () => {
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-25T12:00:00.000Z'),
      operationalPeriods: [],
      financialPeriods: [],
      financialSchemaAvailable: true,
      myHonorFacts: [
        salesFact({ id: 'myhonor-today', occurredOn: '2026-08-25T10:00:00.000Z', netRevenue: 25_000 }),
      ],
      myHonorSyncedAt: '2026-08-25T10:05:00.000Z',
    })

    expect(analytics.windows.today.coverage).toBe('partial')
    expect(analytics.freshness.sales).toMatchObject({
      coverage: 'partial',
      lastFactAt: '2026-08-25T10:00:00.000Z',
      syncedAt: '2026-08-25T10:05:00.000Z',
    })
  })

  it('builds complete Jan–Jul YTD and comparable YoY from monthly reports', () => {
    const currentFinancial = [
      ...['01', '02', '03', '04', '05'].map((month) => financial(`2026-${month}`, 29_000_000, 17_000_000)),
      financial('2026-06', 29_071_821, 17_362_782.54),
    ]
    const previousFinancial = [
      ...['01', '02', '03', '04', '05', '06'].map((month) => financial(`2025-${month}`, 16_000_000, 10_000_000)),
      financial('2025-07', 20_835_303, 10_000_000),
      financial('2025-08', 10_000_000, 7_000_000),
      financial('2025-09', 10_000_000, 7_000_000, { completeness: 'partial' }),
      financial('2025-10', 10_000_000, 7_000_000, { completeness: 'provisional' }),
      financial('2025-11', 10_000_000, 7_000_000),
      financial('2025-12', 10_000_000, 7_000_000),
    ]
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-25T06:00:00.000Z'),
      operationalPeriods: [{
        scopeKey: 'month:2026-07',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        publishedAt: '2026-08-12T10:00:00.000Z',
        facts: julyFacts,
      }],
      financialPeriods: [...previousFinancial, ...currentFinancial],
      financialSchemaAvailable: true,
      myHonorFacts: [],
      myHonorSyncedAt: null,
    })

    expect(analytics.windows.yearToDate.period).toEqual({ from: '2026-01-01', to: '2026-07-31' })
    expect(analytics.windows.yearToDate).toMatchObject({
      coverage: 'complete',
      source: 'mixed',
      metrics: {
        revenue: 202_125_074,
        cost: 119_502_757,
        grossProfit: 82_622_317,
      },
    })
    expect(analytics.comparableYtd).toMatchObject({ comparable: true, revenueChangePct: 73 })
    expect(analytics.comparableYtd.previous.metrics.revenue).toBe(116_835_303)
    expect(analytics.windows.previousYear.coverage).toBe('partial')
  })

  it('uses reported P&L values and never subtracts bonus/write-off details twice', () => {
    const periods = [
      financial('2026-05', 10_000_000, 6_000_000, {
        reportedGrossProfit: 4_000_000,
        periodExpenses: 5_000_000,
        bonuses: 900_000,
        writeOffs: 700_000,
        ebitda: -1_000_000,
      }),
      financial('2026-06', 12_000_000, 7_000_000, {
        reportedGrossProfit: 5_000_000,
        periodExpenses: 7_000_000,
        bonuses: 1_200_000,
        writeOffs: 800_000,
        ebitda: -2_000_000,
      }),
      financial('2026-07', 28_053_253, 17_139_974.46, {
        reportedGrossProfit: 10_913_279.29,
        periodExpenses: 18_973_632.38,
        bonuses: 3_000_000,
        writeOffs: 2_000_000,
        ebitda: -8_060_353.09,
      }),
    ]
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-25T06:00:00.000Z'),
      operationalPeriods: [],
      financialPeriods: periods,
      financialSchemaAvailable: true,
      myHonorFacts: [],
      myHonorSyncedAt: null,
    })

    expect(analytics.pnl.periods.reduce((sum, period) => sum + (period.ebitda ?? 0), 0))
      .toBe(-11_060_353.09)
    expect(analytics.pnl.periods.find((period) => period.month === '2026-07')).toMatchObject({
      grossProfit: 10_913_279.29,
      ebitda: -8_060_353.09,
      bonuses: 3_000_000,
      writeOffs: 2_000_000,
    })
    expect(analytics.history.find((period) => period.month === '2026-07')?.metrics.grossProfit)
      .toBe(10_913_278.54)
    expect(analytics.pnl.hasNegativeEbitda).toBe(true)
  })
})
