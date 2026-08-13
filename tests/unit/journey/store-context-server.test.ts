import { describe, expect, it } from 'vitest'
import {
  isStoreJourneyContext,
  redactStoreJourneyState,
  rehydrateStoreJourneyState,
} from '@/lib/journey/store-context'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyState,
} from '@/lib/journey/schema'
import type { StoreOverview } from '@/lib/store/types'

const NOW = '2026-08-13T07:00:00.000Z'
const WORKSPACE_ID = 'journey-user-store-context-owner'

describe('Journey server Store context', () => {
  it('recognizes only the exact Store context header value', () => {
    expect(isStoreJourneyContext(requestWithContext('store'))).toBe(true)
    expect(isStoreJourneyContext(requestWithContext('Store'))).toBe(false)
    expect(isStoreJourneyContext(requestWithContext('store,default'))).toBe(false)
    expect(isStoreJourneyContext(new Request('https://example.test/api/v1/journey'))).toBe(false)
  })

  it('replaces all Point A facts while preserving user-owned goals, dialog, roadmap and layout', () => {
    const live = liveState()
    const browser = browserModifiedState(live)
    const hydrated = rehydrateStoreJourneyState(browser, live)
    const finance = hydrated.widgets.find((widget) => widget.id === 'widget:store:finance')

    expect(hydrated.companyName).toBe('Интернет-магазин HONOR / MyHonor')
    expect(hydrated.businessDescription).not.toContain('Подмена браузера')
    expect(hydrated.facts.find((fact) => fact.id === 'fact:store:revenue')?.value)
      .toBe('28 053 253 ₸')
    expect(hydrated.facts.some((fact) => fact.id === 'fact:browser:revenue-shadow')).toBe(false)
    expect(hydrated.facts.some((fact) => fact.id === 'fact:user:priority')).toBe(false)
    expect(hydrated.facts.some((fact) => fact.id === 'fact:browser:alternate-revenue')).toBe(false)
    expect(hydrated.goals).toContainEqual(expect.objectContaining({ id: 'goal:user:margin' }))
    expect(hydrated.messages).toContainEqual(expect.objectContaining({ id: 'message:user:goal' }))
    expect(hydrated.roadmap).toContainEqual(expect.objectContaining({ id: 'roadmap:user:experiment' }))
    expect(hydrated.widgets).toContainEqual(expect.objectContaining({ id: 'widget:user:tasks' }))
    expect(finance?.position).toEqual({ x: 640, y: 700 })
    if (!finance || finance.kind !== 'finance_cashflow') throw new Error('finance widget missing')
    expect(finance.data.metrics).toContainEqual(expect.objectContaining({
      label: 'Выручка',
      value: '28 053 253 ₸',
    }))
  })

  it('persists a metric-free Store shell and rehydrates it back to live values', () => {
    const live = liveState()
    const hydrated = rehydrateStoreJourneyState(browserModifiedState(live), live)
    const redacted = redactStoreJourneyState(hydrated)
    const serialized = JSON.stringify(redacted)

    expect(redacted.companyName).toBe('')
    expect(redacted.businessDescription).toBe('')
    expect(redacted.facts).toEqual([])
    expect(redacted.messages).toContainEqual(expect.objectContaining({ id: 'message:user:goal' }))
    expect(redacted.messages).toContainEqual(expect.objectContaining({
      id: 'message:user:goal',
      text: 'Цель владельца: не более 9 возвратов.',
    }))
    expect(redacted.roadmap).toContainEqual(expect.objectContaining({ id: 'roadmap:user:experiment' }))
    expect(redacted.widgets).toContainEqual(expect.objectContaining({
      id: 'widget:store:finance',
      position: { x: 640, y: 700 },
    }))
    expect(serialized).not.toContain('28 053 253')
    expect(serialized).not.toContain('28053253')
    expect(serialized).not.toContain('10 913 278')
    expect(serialized).not.toContain('Интернет-магазин HONOR / MyHonor')
    expect(serialized).not.toContain('fact:store:')
    const passport = redacted.widgets.find((widget) => widget.kind === 'business_passport')
    expect(passport?.kind).toBe('business_passport')
    if (!passport || passport.kind !== 'business_passport') throw new Error('passport missing')
    expect(passport.data.facts).toEqual([])
    const funnel = redacted.widgets.find((widget) => widget.kind === 'sales_funnel')
    expect(funnel?.kind).toBe('sales_funnel')
    if (!funnel || funnel.kind !== 'sales_funnel') throw new Error('funnel missing')
    expect(funnel.data.metrics[0]).toEqual({
      label: 'Выручка',
      status: 'unknown',
      sourceLabel: 'Store live · загружается с сервера',
    })
    const news = redacted.widgets.find((widget) => widget.id === 'widget:user:news-9')
    expect(news?.kind).toBe('news_digest')
    if (!news || news.kind !== 'news_digest') throw new Error('news widget missing')
    expect(news.data.items[0]).toEqual(expect.objectContaining({
      url: 'https://example.test/store/9',
      publishedAt: '2026-09-09T09:00:00.000Z',
    }))

    const restored = rehydrateStoreJourneyState(redacted, live)
    expect(restored.companyName).toBe('Интернет-магазин HONOR / MyHonor')
    expect(restored.facts.find((fact) => fact.id === 'fact:store:revenue')?.value)
      .toBe('28 053 253 ₸')
    expect(restored.widgets.find((widget) => widget.id === 'widget:store:finance')?.position)
      .toEqual({ x: 640, y: 700 })
  })
})

function requestWithContext(value: string): Request {
  return new Request('https://example.test/api/v1/journey', {
    headers: { 'x-journey-context': value },
  })
}

function liveState(): JourneyState {
  return buildStoreJourneyState(completeOverview(), {
    workspaceId: WORKSPACE_ID,
    now: NOW,
  })
}

function browserModifiedState(live: JourneyState): JourneyState {
  return journeyStateSchema.parse({
    ...live,
    companyName: 'Подмена браузера',
    businessDescription: 'Подмена браузера и финансовых показателей.',
    messages: [
      ...live.messages,
      {
        id: 'message:user:goal',
        role: 'user',
        text: 'Цель владельца: не более 9 возвратов.',
        createdAt: NOW,
      },
    ],
    facts: [
      ...live.facts.map((fact) => fact.id === 'fact:store:revenue'
        ? { ...fact, value: '1 ₸' }
        : fact),
      {
        id: 'fact:browser:revenue-shadow',
        label: 'Выручка',
        value: '2 ₸',
        category: 'finance',
        sourceLabel: 'Браузер',
        status: 'confirmed',
      },
      {
        id: 'fact:user:priority',
        label: 'Приоритет владельца',
        value: 'Сократить замороженный остаток',
        category: 'goal',
        sourceLabel: 'Диалог с владельцем',
        status: 'confirmed',
      },
      {
        id: 'fact:browser:alternate-revenue',
        label: 'Оборот после корректировок',
        value: '999 999 999 ₸',
        category: 'finance',
        sourceLabel: 'Браузер',
        status: 'confirmed',
      },
    ],
    goals: [{
      id: 'goal:user:margin',
      title: 'Улучшить валовую маржу',
      metric: 'Валовая маржа',
      target: '42%',
      deadline: '31 декабря 2026',
      status: 'confirmed',
    }],
    roadmap: [
      ...live.roadmap,
      {
        id: 'roadmap:user:experiment',
        title: 'Проверить скидочную матрицу',
        description: 'Провести один управляемый эксперимент.',
        horizon: '30 дней',
        progress: 0,
        status: 'planned',
      },
    ],
    widgets: [
      ...live.widgets.map((widget) => widget.id === 'widget:store:finance'
        ? journeyWidgetSchema.parse({
            ...widget,
            position: { x: 640, y: 700 },
            data: widget.kind === 'finance_cashflow'
              ? {
                  ...widget.data,
                  metrics: widget.data.metrics.map((metric) => (
                    metric.label === 'Выручка' ? { ...metric, value: '1 ₸' } : metric
                  )),
                }
              : widget.data,
          })
        : widget),
      {
        id: 'widget:user:tasks',
        kind: 'tasks_reminders',
        title: 'Решения владельца',
        priority: 50,
        collapsed: false,
        hidden: false,
        focused: false,
        position: { x: 120, y: 900 },
        data: {
          items: [{
            id: 'task:user:experiment',
            text: 'Согласовать эксперимент при выручке 28 053 253 ₸ (28053253)',
            done: false,
          }],
        },
      },
      {
        id: 'widget:user:passport',
        kind: 'business_passport',
        title: 'Паспорт из AI',
        priority: 49,
        collapsed: true,
        hidden: false,
        focused: false,
        position: { x: 450, y: 900 },
        data: {
          facts: [live.facts.find((fact) => fact.id === 'fact:store:revenue')!],
        },
      },
      {
        id: 'widget:user:funnel',
        kind: 'sales_funnel',
        title: 'Воронка из AI',
        priority: 48,
        collapsed: true,
        hidden: false,
        focused: false,
        position: { x: 780, y: 900 },
        data: {
          connected: true,
          metrics: [{
            label: 'Выручка',
            value: '28 053 253 ₸',
            status: 'known',
            sourceLabel: 'fact:store:revenue',
          }],
          nextQuestion: 'Как изменить 28 053 253 ₸?',
        },
      },
      {
        id: 'widget:user:news-9',
        kind: 'news_digest',
        title: 'Новости 9 сентября',
        priority: 47,
        collapsed: true,
        hidden: false,
        focused: false,
        position: { x: 1_100, y: 900 },
        data: {
          connected: true,
          statusText: 'Подключено 9 источников',
          items: [{
            title: 'Обзор магазина за 9 сентября',
            source: 'Store 9',
            url: 'https://example.test/store/9',
            publishedAt: '2026-09-09T09:00:00.000Z',
          }],
        },
      },
    ],
    manualWidgetIds: ['widget:store:finance', 'widget:user:tasks'],
    widgetOrder: [
      ...(live.widgetOrder ?? []),
      'widget:user:tasks',
      'widget:user:passport',
      'widget:user:funnel',
      'widget:user:news-9',
    ],
  })
}

function completeOverview(): StoreOverview {
  return {
    source: 'operational',
    confidence: 'complete',
    companyName: 'Интернет-магазин HONOR / MyHonor',
    period: { from: '2026-07-01', to: '2026-07-31' },
    asOf: '2026-08-07',
    versionLabel: 'Продажи · 12.08.2026',
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
      warehouses: [],
    },
    channels: [],
    alerts: [{
      id: 'high-discount',
      level: 'warning',
      title: 'Скидки забирают более 30% прайсовой выручки',
      description: 'Средневзвешенное влияние скидок — 33,3%.',
    }],
    limitations: [],
  }
}
