import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoreOverviewView } from '@/components/store/StoreOverviewView'
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
})
