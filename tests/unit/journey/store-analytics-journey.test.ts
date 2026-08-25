import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  JourneyMobileBoard,
  selectStoreCanvasFacts,
} from '@/components/journey/JourneyCanvas'
import { WidgetRenderer } from '@/components/journey/widgets/WidgetRenderer'
import { journeyStateSchema } from '@/lib/journey/schema'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import type {
  StoreAnalytics,
  StoreAnalyticsMonth,
  StoreAnalyticsSlice,
  StoreOverview,
  StoreSalesMetrics,
} from '@/lib/store/types'

const NOW = '2026-08-25T07:00:00.000Z'
const LATEST_REVENUE = 28_053_253
const LATEST_GROSS_PROFIT = 10_913_278.54

describe('Store Analytics v2 → canonical Journey', () => {
  it('uses latestPublished for exactly six ordered Point A facts with exact provenance', () => {
    const state = buildStoreJourneyState(analyticsOverview(), {
      workspaceId: 'journey-store-analytics-v2',
      now: NOW,
    })

    expect(journeyStateSchema.safeParse(state).success).toBe(true)
    expect(state.goals).toEqual([])
    expect(state.facts.map((fact) => fact.id)).toEqual([
      'fact:store:period',
      'fact:store:revenue',
      'fact:store:gross-profit',
      'fact:store:gross-margin',
      'fact:store:inventory',
      'fact:store:freshness',
    ])
    expect(state.facts.map((fact) => fact.value)).toEqual([
      '01 июл. 2026 г. — 31 июл. 2026 г.',
      '28 053 253 ₸',
      '10 913 278,54 ₸',
      '38,9%',
      '62 039 ед.',
      expect.stringContaining('Последний факт: 31 июл. 2026 г.'),
    ])
    for (const fact of state.facts) {
      expect(fact.sourceLabel).toContain('source=')
      expect(fact.sourceLabel).toContain('scope=')
      expect(fact.sourceLabel).toContain('period=')
      expect(fact.sourceLabel).toContain('coverage=')
      expect(fact.sourceLabel).not.toContain('live')
    }

    const selected = selectStoreCanvasFacts(state.facts)
    expect(selected.map((fact) => fact.id)).toEqual(state.facts.map((fact) => fact.id))

    const mobile = renderToStaticMarkup(createElement(JourneyMobileBoard, { state }))
    const pointA = mobile.slice(0, mobile.indexOf('data-testid="journey-roadmap"'))
    expect(pointA).toContain('28 053 253 ₸')
    expect(pointA).toContain('62 039 ед.')
    expect(pointA).not.toContain('Себестоимость')
    expect(pointA).not.toContain('Продано единиц')
  })

  it('shows six financial metrics from confirmed July, YTD history and direct P&L EBITDA values', () => {
    const state = buildStoreJourneyState(analyticsOverview(), {
      workspaceId: 'journey-store-analytics-finance',
      now: NOW,
    })
    const finance = state.widgets.find((widget) => widget.id === 'widget:store:finance')
    expect(finance?.kind).toBe('finance_cashflow')
    if (!finance || finance.kind !== 'finance_cashflow') throw new Error('finance widget missing')

    expect(finance.data.metrics).toEqual([
      expect.objectContaining({ label: 'Выручка · июль 2026', value: '28 053 253 ₸', status: 'known' }),
      expect.objectContaining({ label: 'Валовая прибыль · июль 2026', value: '10 913 278,54 ₸', status: 'known' }),
      expect.objectContaining({ label: 'Валовая маржа · июль 2026', value: '38,9%', status: 'known' }),
      expect.objectContaining({ label: 'Выручка YTD 2026', value: '49 053 253 ₸', status: 'known' }),
      expect.objectContaining({ label: 'Валовая прибыль YTD 2026', value: '17 813 278,54 ₸', status: 'known' }),
      expect.objectContaining({ label: 'EBITDA · май–июль 2026', value: '2 500 000 ₸', status: 'known' }),
    ])
    expect(finance.data.metrics[5]?.sourceLabel).toContain('source=financial_report')
    expect(finance.data.metrics[5]?.sourceLabel).toContain('scope=pnl:2026-05,pnl:2026-06,pnl:2026-07')
    expect(finance.data.metrics[5]?.sourceLabel).toContain('coverage=complete')

    const markup = renderToStaticMarkup(createElement(WidgetRenderer, { widget: finance }))
    expect(markup).toContain('title="Источник: source=operational; scope=month:2026-07')
    expect(markup).toContain('title="Источник: source=financial_report; scope=pnl:2026-05')
    expect(markup).toContain('Источники метрик')
    expect(markup).toContain('source=financial_report; scope=pnl:2026-05')
  })

  it('keeps sales, inventory and catalog provenance separate in operations metrics', () => {
    const overview = analyticsOverview()
    if (!overview.analytics) throw new Error('analytics missing')
    overview.analytics.freshness.catalog = {
      coverage: 'stale',
      lastFactAt: '2026-08-06',
      publishedAt: null,
      syncedAt: '2026-08-06T08:00:00.000Z',
    }
    const state = buildStoreJourneyState(overview, {
      workspaceId: 'journey-store-analytics-provenance',
      now: NOW,
    })
    const operations = state.widgets.find((widget) => widget.id === 'widget:store:operations')
    expect(operations?.kind).toBe('domain_metrics')
    if (!operations || operations.kind !== 'domain_metrics') throw new Error('operations widget missing')

    expect(operations.data.metrics.find((metric) => metric.label === 'Доступно на складах')?.sourceLabel)
      .toBe('source=operational; scope=inventory; period=2026-08-07..2026-08-07; coverage=stale')
    expect(operations.data.metrics.find((metric) => metric.label === 'Товаров в контуре')?.sourceLabel)
      .toBe('source=myhonor; scope=catalog; period=2026-08-06..2026-08-06; coverage=stale')
  })

  it('treats uncovered today/MTD and negative EBITDA as risks without fake zero or Point B', () => {
    const state = buildStoreJourneyState(analyticsOverview(), {
      workspaceId: 'journey-store-analytics-gaps',
      now: NOW,
    })
    const risks = state.widgets.find((widget) => widget.id === 'widget:store:risks')
    expect(risks?.kind).toBe('risks_opportunities')
    if (!risks || risks.kind !== 'risks_opportunities') throw new Error('risk widget missing')

    expect(risks.data.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Текущий период не покрыт',
        detail: expect.stringContaining('Сегодня: not_covered; MTD: not_covered'),
      }),
      expect.objectContaining({
        title: 'Отрицательная EBITDA',
        detail: expect.stringContaining('июнь 2026: -500 000 ₸'),
      }),
    ]))
    expect(state.roadmap[0]).toEqual(expect.objectContaining({
      id: 'roadmap:store:restore-current-period',
      title: 'Загрузить август 2026 или обновить подключение',
      status: 'next',
    }))
    expect(state.goals).toEqual([])
    expect(state.facts.some((fact) => fact.label === 'Сегодня')).toBe(false)
    expect(state.facts.some((fact) => fact.value === '0 ₸')).toBe(false)
  })

  it('never confirms null metrics and never labels stale MyHonor data as live', () => {
    const overview = analyticsOverview()
    if (!overview.analytics) throw new Error('analytics missing')
    overview.source = 'myhonor'
    overview.versionLabel = 'MyHonor · live'
    overview.inventory.availableUnits = null
    overview.analytics.windows.latestPublished = {
      ...overview.analytics.windows.latestPublished,
      coverage: 'partial',
      source: 'myhonor',
      scopeKey: null,
      scopeKeys: [],
      metrics: {
        ...overview.analytics.windows.latestPublished.metrics,
        revenue: null,
        grossProfit: null,
        grossMarginPct: null,
      },
    }
    overview.analytics.freshness.sales = {
      coverage: 'stale',
      lastFactAt: null,
      publishedAt: null,
      syncedAt: '2026-07-31T20:00:00.000Z',
    }

    const state = buildStoreJourneyState(overview, {
      workspaceId: 'journey-store-stale-myhonor',
      now: NOW,
    })
    const serialized = JSON.stringify(state)

    expect(state.facts.map((fact) => fact.id)).toEqual(['fact:store:period'])
    expect(state.facts.every((fact) => fact.value.trim().length > 0)).toBe(true)
    expect(serialized).not.toContain('MyHonor live')
    expect(serialized).not.toContain('MyHonor · live')
    expect(state.persistence.label).toBe('Store · без копии в Journey')
    expect(serialized).toContain('source=myhonor; scope=none; period=2026-07-01..2026-07-31; coverage=partial')

    const legacyOverview = analyticsOverview()
    legacyOverview.source = 'myhonor'
    legacyOverview.analytics = undefined
    const legacyState = buildStoreJourneyState(legacyOverview, {
      workspaceId: 'journey-store-legacy-myhonor',
      now: NOW,
    })
    expect(legacyState.facts.length).toBeGreaterThan(0)
    expect(legacyState.facts.every((fact) => (
      fact.sourceLabel === 'Store Control Center · MyHonor · наблюдаемые заказы'
    ))).toBe(true)
    expect(legacyState.persistence.label).toBe('Store · без копии в Journey')
  })
})

function analyticsOverview(): StoreOverview {
  return {
    source: 'operational',
    confidence: 'complete',
    companyName: 'Интернет-магазин HONOR / MyHonor',
    period: { from: '2026-07-01', to: '2026-07-31' },
    asOf: '2026-08-07',
    versionLabel: 'Продажи · 12.08.2026',
    availability: { sales: true, inventory: true, prices: true },
    // Legacy headline metrics are intentionally absent. Analytics v2 owns the
    // Journey projection and must not reinterpret uncovered today/MTD as zero.
    metrics: emptyMetrics(),
    catalog: { products: 1_365, activeProducts: 1_365, latest: [] },
    inventory: {
      availableUnits: 62_039,
      reservedUnits: 0,
      inventoryCost: 221_500_000,
      inventoryRetail: 365_000_000,
      warehouses: [],
    },
    channels: [],
    alerts: [],
    limitations: [],
    analytics: analyticsFixture(),
  }
}

function analyticsFixture(): StoreAnalytics {
  const history = [
    monthSlice('2026-01', 1_000_000, 400_000),
    monthSlice('2026-02', 2_000_000, 800_000),
    monthSlice('2026-03', 3_000_000, 1_000_000),
    monthSlice('2026-04', 4_000_000, 1_200_000),
    monthSlice('2026-05', 5_000_000, 1_500_000),
    monthSlice('2026-06', 6_000_000, 2_000_000),
    monthSlice('2026-07', LATEST_REVENUE, LATEST_GROSS_PROFIT),
  ]
  const latestPublished = history[6]
  if (!latestPublished) throw new Error('latest period missing')

  return {
    schemaVersion: 2,
    timezone: 'Asia/Almaty',
    generatedAt: NOW,
    currentDate: '2026-08-25',
    windows: {
      today: uncoveredSlice('today', { from: '2026-08-25', to: '2026-08-25' }),
      monthToDate: uncoveredSlice('monthToDate', { from: '2026-08-01', to: '2026-08-25' }),
      latestPublished: {
        ...latestPublished,
        key: 'latestPublished',
      },
      yearToDate: {
        ...uncoveredSlice('yearToDate', { from: '2026-01-01', to: '2026-08-25' }),
        coverage: 'partial',
        source: 'operational',
        scopeKeys: history.map((period) => period.scopeKey).filter((scope): scope is string => Boolean(scope)),
        message: 'Август не опубликован.',
      },
      previousYear: uncoveredSlice('previousYear', { from: '2025-01-01', to: '2025-12-31' }),
    },
    history,
    comparableYtd: {
      currentYear: 2026,
      previousYear: 2025,
      current: uncoveredSlice('yearToDate', { from: '2026-01-01', to: '2026-08-25' }),
      previous: uncoveredSlice('previousYear', { from: '2025-01-01', to: '2025-08-25' }),
      revenueChangePct: null,
      grossProfitChangePct: null,
      comparable: false,
      message: 'Нет сопоставимого прошлого периода.',
    },
    pnl: {
      coverage: 'complete',
      periods: [
        pnlPeriod('2026-05', 1_000_000),
        pnlPeriod('2026-06', -500_000),
        pnlPeriod('2026-07', 2_000_000),
      ],
      hasNegativeEbitda: true,
      message: null,
    },
    freshness: {
      sales: {
        coverage: 'stale',
        lastFactAt: '2026-07-31T18:00:00.000Z',
        publishedAt: '2026-08-12T09:00:00.000Z',
        syncedAt: null,
      },
      inventory: {
        coverage: 'stale',
        lastFactAt: '2026-08-07',
        publishedAt: '2026-08-07T12:00:00.000Z',
        syncedAt: null,
      },
      prices: {
        coverage: 'stale',
        lastFactAt: '2026-08-07',
        publishedAt: '2026-08-07T12:00:00.000Z',
        syncedAt: null,
      },
      catalog: {
        coverage: 'stale',
        lastFactAt: '2026-08-07',
        publishedAt: '2026-08-07T12:00:00.000Z',
        syncedAt: null,
      },
    },
    limitations: [],
  }
}

function monthSlice(
  month: string,
  revenue: number,
  grossProfit: number,
): StoreAnalyticsMonth {
  const period = monthPeriod(month)
  return {
    key: `month:${month}`,
    month,
    period,
    coverage: 'complete',
    source: 'operational',
    scopeKey: `month:${month}`,
    scopeKeys: [`month:${month}`],
    lastFactAt: `${period.to}T18:00:00.000Z`,
    publishedAt: '2026-08-12T09:00:00.000Z',
    syncedAt: null,
    metrics: {
      ...emptyMetrics(),
      revenue,
      cost: revenue - grossProfit,
      grossProfit,
      grossMarginPct: revenue === 0 ? null : grossProfit / revenue * 100,
    },
    message: null,
  }
}

function uncoveredSlice(
  key: StoreAnalyticsSlice['key'],
  period: StoreAnalyticsSlice['period'],
): StoreAnalyticsSlice {
  return {
    key,
    period,
    coverage: 'not_covered',
    source: 'none',
    scopeKey: null,
    scopeKeys: [],
    lastFactAt: null,
    publishedAt: null,
    syncedAt: null,
    metrics: emptyMetrics(),
    message: 'Нет опубликованного отчёта; отсутствие строк не равно нулю.',
  }
}

function pnlPeriod(month: string, ebitda: number) {
  return {
    month,
    coverage: 'complete' as const,
    source: 'financial_report' as const,
    scopeKey: `pnl:${month}`,
    sourceSheet: 'P&L',
    publishedAt: '2026-08-12T09:00:00.000Z',
    revenue: 10_000_000,
    costAmount: 6_000_000,
    grossProfit: 4_000_000,
    periodExpenses: 1_000_000,
    bonuses: 200_000,
    writeOffs: 100_000,
    // Direct stored value intentionally differs from a local recomputation.
    ebitda,
    note: null,
  }
}

function monthPeriod(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function emptyMetrics(): StoreSalesMetrics {
  return {
    revenue: null,
    cost: null,
    grossProfit: null,
    grossMarginPct: null,
    listRevenue: null,
    discount: null,
    discountRatePct: null,
    units: null,
    returns: null,
  }
}
