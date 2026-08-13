import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  JourneyExperience,
  getJourneyExperienceStage,
  isJourneyConversationFirst,
} from '@/components/journey/JourneyExperience'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import { journeyStateSchema } from '@/lib/journey/schema'
import type { StoreOverview } from '@/lib/store/types'

const NOW = '2026-08-13T07:00:00.000Z'

function completeOverview(overrides: Partial<StoreOverview> = {}): StoreOverview {
  return {
    source: 'operational',
    confidence: 'complete',
    companyName: 'Интернет-магазин HONOR / MyHonor',
    period: { from: '2026-07-01', to: '2026-07-31' },
    asOf: '2026-08-07',
    versionLabel: '6 опубликованных версий',
    availability: { sales: true, inventory: true, prices: true },
    metrics: {
      revenue: 28_053_253,
      cost: 17_139_974.46,
      grossProfit: 10_913_278.54,
      grossMarginPct: 38.902024,
      listRevenue: 42_082_620,
      discount: 14_029_367,
      discountRatePct: 33.337668,
      units: 1_324,
      returns: 9,
    },
    catalog: { products: 1_365, activeProducts: 1_365, latest: [] },
    inventory: {
      availableUnits: 62_039,
      reservedUnits: 0,
      inventoryCost: 221_500_000,
      inventoryRetail: 365_000_000,
      warehouses: [
        { warehouse: 'Астана', available: 12_000, reserved: 0, inventoryCost: 1, inventoryRetail: 2, snapshotDate: '2026-08-07' },
        { warehouse: 'Kaspi', available: 13_000, reserved: 0, inventoryCost: 1, inventoryRetail: 2, snapshotDate: '2026-08-07' },
        { warehouse: 'Основной', available: 20_000, reserved: 0, inventoryCost: 1, inventoryRetail: 2, snapshotDate: '2026-08-07' },
        { warehouse: 'Усть-Каменогорск', available: 17_039, reserved: 0, inventoryCost: 1, inventoryRetail: 2, snapshotDate: '2026-08-07' },
      ],
    },
    channels: [],
    alerts: [
      {
        id: 'high-discount',
        level: 'warning',
        title: 'Скидки забирают более 30% прайсовой выручки',
        description: 'Средневзвешенное влияние скидок — 33,3%.',
      },
    ],
    limitations: [],
    ...overrides,
  }
}

describe('Store → Journey live projection', () => {
  it('keeps the published acceptance totals exact and passes the allowlisted schema', () => {
    const state = buildStoreJourneyState(completeOverview(), {
      workspaceId: 'store-journey-acceptance-owner',
      now: NOW,
    })

    expect(journeyStateSchema.safeParse(state).success).toBe(true)
    const finance = state.widgets.find((widget) => widget.kind === 'finance_cashflow')
    expect(finance?.kind).toBe('finance_cashflow')
    if (!finance || finance.kind !== 'finance_cashflow') throw new Error('finance widget missing')
    expect(finance.data.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Выручка', value: '28 053 253 ₸', status: 'known' }),
      expect.objectContaining({ label: 'Себестоимость', value: '17 139 974,46 ₸', status: 'known' }),
      expect.objectContaining({ label: 'Валовая прибыль', value: '10 913 278,54 ₸', status: 'known' }),
      expect.objectContaining({ label: 'Валовая маржа', value: '38,9%', status: 'known' }),
      expect.objectContaining({ label: 'Скидки', value: '14 029 367 ₸', status: 'known' }),
    ]))
    expect(state.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Доступный остаток', value: '62 039 ед.' }),
      expect.objectContaining({ label: 'Товаров в контуре', value: '1 365' }),
    ]))
  })

  it('does not invent Point B, forecasts, or zero values for missing facts', () => {
    const overview = completeOverview({
      confidence: 'partial',
      metrics: {
        ...completeOverview().metrics,
        cost: null,
        grossProfit: null,
        grossMarginPct: null,
        returns: null,
      },
      inventory: {
        availableUnits: null,
        reservedUnits: null,
        inventoryCost: null,
        inventoryRetail: null,
        warehouses: [],
      },
    })
    const state = buildStoreJourneyState(overview, {
      workspaceId: 'store-journey-partial-owner',
      now: NOW,
    })
    const serialized = JSON.stringify(state)
    const finance = state.widgets.find((widget) => widget.kind === 'finance_cashflow')

    expect(state.goals).toEqual([])
    expect(serialized).not.toContain('прогноз')
    expect(serialized).not.toContain('средний чек')
    expect(finance?.kind).toBe('finance_cashflow')
    if (!finance || finance.kind !== 'finance_cashflow') throw new Error('finance widget missing')
    expect(finance.data.metrics.find((metric) => metric.label === 'Себестоимость')).toEqual({
      label: 'Себестоимость',
      status: 'unknown',
      sourceLabel: 'Нужно подтвердить источник',
    })
    expect(state.facts.some((fact) => fact.label === 'Доступный остаток')).toBe(false)
  })

  it('maps source readiness and Store alerts without adding a new alert', () => {
    const overview = completeOverview({
      availability: { sales: true, inventory: false, prices: true },
      alerts: [{
        id: 'inventory-missing',
        level: 'warning',
        title: 'Остатки ещё не подключены',
        description: 'Система пока не может показать дефицит.',
      }],
    })
    const state = buildStoreJourneyState(overview, {
      workspaceId: 'store-journey-readiness-owner',
      now: NOW,
    })
    const process = state.widgets.find((widget) => widget.kind === 'domain_process')
    const risks = state.widgets.find((widget) => widget.kind === 'risks_opportunities')
    expect(process?.kind).toBe('domain_process')
    expect(risks?.kind).toBe('risks_opportunities')
    if (!process || process.kind !== 'domain_process') throw new Error('process widget missing')
    if (!risks || risks.kind !== 'risks_opportunities') throw new Error('risks widget missing')
    expect(process.data.stages.find((stage) => stage.id === 'store:inventory')).toEqual(expect.objectContaining({
      status: 'blocked',
      nextAction: 'Опубликовать источник «Остатки»',
    }))
    expect(risks.data.risks).toEqual([{ title: 'Остатки ещё не подключены', detail: 'Система пока не может показать дефицит.', status: 'risk' }])
  })

  it('enters the canonical goal conversation with a grounded Store summary', () => {
    const overview = completeOverview({ companyName: '<script>alert(1)</script>' })
    const state = buildStoreJourneyState(overview, {
      workspaceId: 'store-journey-render-owner',
      now: NOW,
    })
    const html = renderToStaticMarkup(createElement(JourneyExperience, {
      state,
      context: 'store',
      onDraftRequest: () => undefined,
    }))

    expect(getJourneyExperienceStage(state)).toBe('goal')
    expect(isJourneyConversationFirst(state)).toBe(true)
    expect(html).toContain('data-stage="goal"')
    expect(html).toContain('Бизнес')
    expect(html).toContain('Точка A')
    expect(html).toContain('Точка B')
    expect(html).toContain('Первый шаг')
    expect(html).toContain('28 053 253 ₸')
    expect(html).toContain('Скидки забирают более 30%')
    expect(html).toContain('Уточните измеримую цель')
    expect(html).toContain('Продолжить с AI')
    expect(html).toContain('Подтверждённые показатели Store')
    expect(html).toContain('Точка A · Store live')
    expect(html).toContain('read-only')
    expect(html).toContain('10 913 278,54 ₸')
    expect(html).toContain('62 039 ед.')
    expect(html).not.toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('Store · live read-only')

    const empty = completeOverview({
      source: 'empty',
      confidence: 'empty',
      companyName: null,
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
      inventory: { availableUnits: null, reservedUnits: null, inventoryCost: null, inventoryRetail: null, warehouses: [] },
      alerts: [],
      limitations: ['Нет опубликованных данных магазина.'],
    })
    const emptyState = buildStoreJourneyState(empty, {
      workspaceId: 'store-journey-empty-owner',
      now: NOW,
    })
    const emptyHtml = renderToStaticMarkup(createElement(JourneyExperience, {
      state: emptyState,
      context: 'store',
      onDraftRequest: () => undefined,
    }))
    expect(getJourneyExperienceStage(emptyState)).toBe('describe')
    expect(emptyHtml).toContain('data-stage="describe"')
    expect(emptyHtml).toContain('Пока нет подтверждённых фактов')
    expect(emptyHtml).toContain('В Store пока нет опубликованных фактов')
    expect(emptyHtml).toContain('Продолжить с AI')
  })
})
