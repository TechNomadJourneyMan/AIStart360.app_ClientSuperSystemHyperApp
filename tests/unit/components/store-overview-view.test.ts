import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoreOverviewView } from '@/components/store/StoreOverviewView'
import { buildStoreAnalytics } from '@/lib/store/analytics'
import type { StoreOverview } from '@/lib/store/types'

const empty: StoreOverview = {
  source: 'empty',
  confidence: 'empty',
  companyName: 'HONOR GROUP',
  period: null,
  asOf: null,
  versionLabel: null,
  availability: { sales: false, inventory: false, prices: false },
  metrics: {
    revenue: null,
    cost: null,
    grossProfit: null,
    grossMarginPct: null,
    listRevenue: null,
    discount: null,
    discountRatePct: null,
    units: null,
    returns: null,
  },
  catalog: { products: 0, activeProducts: 0, latest: [] },
  inventory: {
    availableUnits: null,
    reservedUnits: null,
    inventoryCost: null,
    inventoryRetail: null,
    warehouses: [],
  },
  channels: [],
  alerts: [{
    id: 'missing',
    level: 'warning',
    title: 'Нет опубликованного отчёта продаж',
    description: 'Загрузите данные.',
    actionHref: '/store/imports',
    actionLabel: 'Загрузить данные',
  }],
  limitations: ['Нет опубликованных данных магазина.'],
}

describe('StoreOverviewView', () => {
  it('renders an honest empty state without demo business values', () => {
    const html = renderToStaticMarkup(createElement(StoreOverviewView, { data: empty }))
    expect(html).toContain('Магазин')
    expect(html).toContain('Данные не подключены')
    expect(html).toContain('Нет данных по каналам')
    expect(html).toContain('Склады ещё не подключены')
    expect(html).toContain('Каталог пуст')
    expect(html).not.toContain('28,1 млн')
  })

  it('renders confirmed money and margin from the supplied DTO', () => {
    const data: StoreOverview = {
      ...empty,
      source: 'operational',
      confidence: 'complete',
      availability: { sales: true, inventory: true, prices: true },
      period: { from: '2026-07-01', to: '2026-07-31' },
      asOf: '2026-08-08T10:00:00.000Z',
      versionLabel: 'Продажи · 08.08.2026',
      metrics: {
        revenue: 28_053_253,
        cost: 17_139_974,
        grossProfit: 10_913_279,
        grossMarginPct: 38.9,
        listRevenue: 42_082_620,
        discount: 14_029_367,
        discountRatePct: 33.34,
        units: 1_324,
        returns: 5,
      },
      alerts: [],
      limitations: [],
    }
    const html = renderToStaticMarkup(createElement(StoreOverviewView, { data }))
    expect(html).toContain('28,1 млн ₸')
    expect(html).toContain('10,9 млн ₸')
    expect(html).toContain('38,9%')
    expect(html).toContain('14 млн ₸')
  })

  it('renders the period selector, provenance, history table and honest P&L warning', () => {
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-25T06:00:00.000Z'),
      operationalPeriods: [],
      myHonorFacts: [],
      myHonorSyncedAt: '2026-07-29T10:00:00.000Z',
      financialSchemaAvailable: true,
      financialPeriods: [
        {
          month: '2026-05',
          revenue: 10_000_000,
          costAmount: 6_000_000,
          reportedGrossProfit: 4_000_000,
          periodExpenses: 5_000_000,
          bonuses: 900_000,
          writeOffs: 700_000,
          ebitda: -1_000_000,
          completeness: 'complete',
          note: 'Валовая прибыль отчёта отличается от расчётной на 0,75 ₸.',
          scopeKey: 'month:2026-05',
          sourceSheet: 'P&L',
          publishedAt: '2026-08-24T10:00:00.000Z',
        },
        {
          month: '2026-06',
          revenue: 12_000_000,
          costAmount: 7_000_000,
          reportedGrossProfit: 5_000_000,
          periodExpenses: 7_000_000,
          bonuses: 1_200_000,
          writeOffs: 800_000,
          ebitda: -2_000_000,
          completeness: 'complete',
          note: null,
          scopeKey: 'month:2026-06',
          sourceSheet: 'P&L',
          publishedAt: '2026-08-24T10:00:00.000Z',
        },
        {
          month: '2026-07',
          revenue: 28_053_253,
          costAmount: 17_139_974.46,
          reportedGrossProfit: 10_913_279.29,
          periodExpenses: 18_973_632.38,
          bonuses: 3_000_000,
          writeOffs: 2_000_000,
          ebitda: -8_060_353.09,
          completeness: 'complete',
          note: null,
          scopeKey: 'month:2026-07',
          sourceSheet: 'P&L',
          publishedAt: '2026-08-24T10:00:00.000Z',
        },
      ],
    })
    const html = renderToStaticMarkup(createElement(StoreOverviewView, {
      data: {
        ...empty,
        source: 'operational',
        availability: { sales: true, inventory: false, prices: false },
        analytics,
        alerts: [],
      },
    }))

    expect(html).toContain('Сегодня')
    expect(html).toContain('Этот месяц')
    expect(html).toContain('Последний опубликованный')
    expect(html).toContain('2026 YTD')
    expect(html).toContain('Выручка по месяцам')
    expect(html).toContain('P&amp;L · май 2026 г. — июль 2026 г.')
    expect(html).toContain('Отрицательная EBITDA')
    expect(html).toContain('не вычитаются из EBITDA повторно')
    expect(html).toContain('Источник / сверка')
    expect(html).toContain('month:2026-05')
    expect(html).toContain('Сверка: Валовая прибыль отчёта отличается от расчётной на 0,75 ₸.')
    expect(html).not.toContain('MyHonor · live')
  })

  it('shows negative history below the zero baseline and explains an inactive catalog', () => {
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-25T06:00:00.000Z'),
      operationalPeriods: [],
      myHonorFacts: [],
      myHonorSyncedAt: null,
      financialSchemaAvailable: true,
      financialPeriods: [{
        month: '2026-07',
        revenue: 10_000,
        costAmount: 12_000,
        reportedGrossProfit: -2_000,
        periodExpenses: 1_000,
        bonuses: 0,
        writeOffs: 0,
        ebitda: -3_000,
        completeness: 'complete',
        note: null,
        scopeKey: 'month:2026-07',
        sourceSheet: 'P&L',
        publishedAt: '2026-08-24T10:00:00.000Z',
      }],
    })
    const html = renderToStaticMarkup(createElement(StoreOverviewView, {
      data: {
        ...empty,
        source: 'operational',
        catalog: { products: 12, activeProducts: 0, latest: [] },
        analytics,
      },
    }))

    expect(html).toContain('Отрицательное значение')
    expect(html).toContain('top:50%')
    expect(html).toContain('Нет активных товаров')
    expect(html).toContain('ни один не отмечен активным')
  })

  it('rolls the P&L panel forward when a newly published August period arrives', () => {
    const financialPeriods = ['05', '06', '07', '08'].map((month, index) => ({
      month: `2026-${month}`,
      revenue: 10_000_000 + index * 1_000_000,
      costAmount: 6_000_000,
      reportedGrossProfit: 4_000_000 + index * 1_000_000,
      periodExpenses: index === 0 ? 6_000_000 : 3_000_000,
      bonuses: 100_000,
      writeOffs: 50_000,
      ebitda: index === 0 ? -2_000_000 : index * 1_000_000,
      completeness: index === 0 ? 'partial' as const : 'complete' as const,
      note: null,
      scopeKey: `month:2026-${month}`,
      sourceSheet: `P&L 2026-${month}`,
      publishedAt: `2026-08-${String(20 + index).padStart(2, '0')}T10:00:00.000Z`,
    }))
    const analytics = buildStoreAnalytics({
      now: new Date('2026-09-01T06:00:00.000Z'),
      operationalPeriods: [],
      myHonorFacts: [],
      myHonorSyncedAt: null,
      financialSchemaAvailable: true,
      financialPeriods,
    })
    const html = renderToStaticMarkup(createElement(StoreOverviewView, {
      data: { ...empty, source: 'operational', analytics, alerts: [] },
    }))

    expect(html).toContain('P&amp;L · июнь 2026 г. — авг. 2026 г.')
    expect(html).toContain('month:2026-08')
    expect(html).not.toContain('P&amp;L · май 2026 г. — июль 2026 г.')
    expect(html).not.toContain('Отрицательная EBITDA')
    const visiblePnl = html.slice(html.indexOf('P&amp;L · июнь 2026 г. — авг. 2026 г.'))
    expect(visiblePnl.slice(0, 700)).toContain('Полные данные')
  })

  it('marks a newly uploaded provisional August P&L in both the panel and its row', () => {
    const analytics = buildStoreAnalytics({
      now: new Date('2026-08-26T07:00:00.000Z'),
      operationalPeriods: [],
      myHonorFacts: [],
      myHonorSyncedAt: null,
      financialSchemaAvailable: true,
      financialPeriods: [{
        month: '2026-08',
        revenue: 31_000_000,
        costAmount: 18_000_000,
        reportedGrossProfit: 13_000_000,
        periodExpenses: 9_500_000,
        bonuses: 1_000_000,
        writeOffs: 500_000,
        ebitda: 3_500_000,
        completeness: 'provisional',
        note: null,
        scopeKey: 'month:2026-08',
        sourceSheet: 'P&L 2026 (август)',
        publishedAt: '2026-08-26T06:00:00.000Z',
      }],
    })
    const html = renderToStaticMarkup(createElement(StoreOverviewView, {
      data: { ...empty, source: 'operational', analytics, alerts: [] },
    }))

    const pnlSection = html.slice(html.indexOf('P&amp;L · авг. 2026 г.'))
    expect(pnlSection).toContain('Частичное покрытие')
    expect((pnlSection.match(/Частичное покрытие/g) ?? [])).toHaveLength(2)
    expect(pnlSection).toContain('month:2026-08')
  })
})
