import { createEmptyJourneyState } from '@/lib/journey/demo'
import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyState,
  type JourneyWidget,
} from '@/lib/journey/schema'
import { formatDate, formatNumber, formatPercent, formatPeriod } from '@/lib/store/format'
import type { StoreAlert, StoreOverview } from '@/lib/store/types'

interface StoreJourneyStateOptions {
  workspaceId: string
  now?: string
}

type Metric = {
  label: string
  value?: string
  status: 'known' | 'unknown'
  sourceLabel?: string
}

/**
 * Converts the owner-scoped Store aggregate into the existing allowlisted
 * Journey language. The adapter is deliberately pure: it never reads a tenant
 * id, never persists a copy and never turns an absent value into zero.
 */
export function buildStoreJourneyState(
  overview: StoreOverview,
  options: StoreJourneyStateOptions,
): JourneyState {
  const now = options.now ?? new Date().toISOString()
  const source = storeSourceLabel(overview)
  const facts = buildFacts(overview, source)
  const widgets = buildWidgets(overview, source)
  const nextAction = buildNextAction(overview)
  const base = createEmptyJourneyState(options.workspaceId)

  return journeyStateSchema.parse({
    ...base,
    phase: overview.source === 'empty' && facts.length === 0 ? 'empty' : 'partial',
    companyName: overview.companyName ?? '',
    businessDescription: overview.companyName
      ? `Интернет-магазин «${overview.companyName}». Journey показывает только опубликованные агрегаты Store Control Center.`
      : 'Journey показывает только опубликованные агрегаты Store Control Center.',
    messages: [
      {
        id: 'message:store:live-context',
        role: 'assistant',
        text: overview.source === 'empty'
          ? 'Опубликованные данные магазина пока не найдены. Я не буду подставлять демонстрационные показатели или нули.'
          : `Точка A собрана из ${source}. Показатели не скопированы в Journey: это live read-only представление текущей публикации.`,
        createdAt: now,
      },
      {
        id: 'message:store:point-b',
        role: 'assistant',
        text: 'Точка B намеренно не задана. Какой показатель магазина вы хотите изменить, до какого значения и к какому сроку?',
        createdAt: now,
      },
    ],
    facts,
    goals: [],
    roadmap: [nextAction],
    widgets,
    widgetDecisions: widgets.map((widget) => ({
      widgetId: widget.id,
      kind: widget.kind,
      action: 'create' as const,
      reason: widgetReason(widget.kind),
      evidenceFactIds: facts.slice(0, 12).map((fact) => fact.id),
    })),
    manualWidgetIds: [],
    widgetOrder: widgets.map((widget) => widget.id),
    suggestions: [
      {
        id: 'store:define-point-b',
        label: 'Задать Точку B',
        value: 'Помоги сформулировать измеримую цель магазина, но не придумывай исходные значения.',
        target: 'point-b',
        status: 'active',
      },
      {
        id: 'store:review-next-action',
        label: 'Разобрать следующий шаг',
        value: `Разберём действие «${nextAction.title}» только на подтверждённых данных Store.`,
        target: 'roadmap',
        status: 'active',
      },
    ],
    provider: {
      mode: 'live',
      label: 'Store Control Center · server-first',
    },
    persistence: {
      mode: 'database',
      label: 'Live Store · без копии в Journey',
    },
    serverRevision: 0,
    updatedAt: now,
  })
}

function buildFacts(overview: StoreOverview, source: string): JourneyFact[] {
  const facts: JourneyFact[] = []
  const push = (
    id: string,
    label: string,
    value: string | null,
    category: JourneyFact['category'],
  ) => {
    if (!value) return
    facts.push({
      id,
      label,
      value,
      category,
      sourceLabel: source,
      confidence: overview.confidence === 'complete' ? 1 : 0.8,
      status: 'confirmed',
    })
  }

  push('fact:store:company', 'Компания', overview.companyName, 'business')
  push('fact:store:period', 'Фактический период', overview.period ? formatPeriod(overview.period) : null, 'sales')
  push('fact:store:as-of', 'Актуально на', overview.asOf ? formatDate(overview.asOf) : null, 'operations')
  push('fact:store:revenue', 'Выручка', money(overview.metrics.revenue), 'finance')
  push('fact:store:cost', 'Себестоимость', money(overview.metrics.cost), 'finance')
  push('fact:store:gross-profit', 'Валовая прибыль', money(overview.metrics.grossProfit), 'finance')
  push('fact:store:gross-margin', 'Валовая маржа', nullablePercent(overview.metrics.grossMarginPct), 'finance')
  push('fact:store:discount', 'Скидки', money(overview.metrics.discount), 'finance')
  push('fact:store:discount-rate', 'Доля скидок', nullablePercent(overview.metrics.discountRatePct), 'finance')
  push('fact:store:units', 'Продано единиц', nullableNumber(overview.metrics.units), 'sales')
  push('fact:store:returns', 'Возвраты', nullableNumber(overview.metrics.returns), 'sales')
  push('fact:store:inventory', 'Доступный остаток', nullableUnits(overview.inventory.availableUnits), 'operations')
  push('fact:store:reserved', 'Зарезервировано', nullableUnits(overview.inventory.reservedUnits), 'operations')
  push(
    'fact:store:catalog',
    'Товаров в контуре',
    overview.availability.prices || overview.catalog.products > 0
      ? formatNumber(overview.catalog.products)
      : null,
    'product',
  )
  push(
    'fact:store:warehouses',
    'Складов',
    overview.inventory.warehouses.length > 0
      ? formatNumber(overview.inventory.warehouses.length)
      : null,
    'operations',
  )
  return facts
}

function buildWidgets(overview: StoreOverview, source: string): JourneyWidget[] {
  const financial = journeyWidgetSchema.parse({
    id: 'widget:store:finance',
    kind: 'finance_cashflow',
    title: 'Экономика магазина',
    priority: 100,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x: 100, y: 500 },
    data: {
      metrics: [
        metric('Выручка', money(overview.metrics.revenue), source),
        metric('Себестоимость', money(overview.metrics.cost), source),
        metric('Валовая прибыль', money(overview.metrics.grossProfit), source),
        metric('Валовая маржа', nullablePercent(overview.metrics.grossMarginPct), source),
        metric('Скидки', money(overview.metrics.discount), source),
        metric('Доля скидок', nullablePercent(overview.metrics.discountRatePct), source),
      ],
      sourceStatus: overview.availability.sales ? 'connected' : 'missing',
      nextQuestion: overview.availability.sales
        ? 'Какую измеримую Точку B владелец выбирает для следующего сопоставимого периода?'
        : 'Опубликуйте продажи, чтобы рассчитать экономику периода.',
    },
  })

  const operations = journeyWidgetSchema.parse({
    id: 'widget:store:operations',
    kind: 'domain_metrics',
    title: 'Ассортимент и остатки',
    priority: 95,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x: 430, y: 500 },
    data: {
      domain: 'Интернет-магазин и розничная торговля',
      purpose: 'Показывать только подтверждённый операционный масштаб без вычисления будущих значений.',
      metrics: [
        metric('Продано единиц', nullableNumber(overview.metrics.units), source),
        metric('Возвраты', nullableNumber(overview.metrics.returns), source),
        metric('Доступно на складах', nullableUnits(overview.inventory.availableUnits), source),
        metric('Зарезервировано', nullableUnits(overview.inventory.reservedUnits), source),
        metric('Товаров в контуре', overview.catalog.products > 0 ? formatNumber(overview.catalog.products) : null, source),
        metric('Складов', overview.inventory.warehouses.length > 0 ? formatNumber(overview.inventory.warehouses.length) : null, source),
      ],
      guidance: overview.limitations.slice(0, 2).map((detail) => ({
        title: 'Ограничение данных',
        detail,
        status: 'question' as const,
      })),
    },
  })

  const process = journeyWidgetSchema.parse({
    id: 'widget:store:data-process',
    kind: 'domain_process',
    title: 'Контур управленческих данных',
    priority: 90,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x: 760, y: 500 },
    data: {
      domain: 'Store Control Center',
      purpose: 'Отделять опубликованные факты от отсутствующих источников.',
      stages: [
        sourceStage('store:sales', 'Продажи', overview.availability.sales, overview.period ? formatPeriod(overview.period) : undefined),
        sourceStage('store:inventory', 'Остатки', overview.availability.inventory, overview.asOf ? `Снимок ${formatDate(overview.asOf)}` : undefined),
        sourceStage('store:prices', 'Прайс', overview.availability.prices, overview.catalog.products > 0 ? `${formatNumber(overview.catalog.products)} позиций` : undefined),
      ],
    },
  })

  const signals = splitSignals(overview)
  const risks = journeyWidgetSchema.parse({
    id: 'widget:store:risks',
    kind: 'risks_opportunities',
    title: 'Сигналы и ограничения',
    priority: 85,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x: 1090, y: 500 },
    data: signals,
  })

  return [financial, operations, process, risks]
}

function sourceStage(id: string, name: string, ready: boolean, metricValue?: string) {
  return {
    id,
    name,
    status: ready ? 'done' as const : 'blocked' as const,
    ...(metricValue ? { metric: metricValue } : {}),
    nextAction: ready ? 'Источник опубликован' : `Опубликовать источник «${name}»`,
  }
}

function splitSignals(overview: StoreOverview) {
  const risks = overview.alerts
    .filter((alert) => alert.level !== 'info')
    .slice(0, 8)
    .map(alertNote)
  for (const limitation of overview.limitations.slice(0, Math.max(0, 8 - risks.length))) {
    risks.push({
      title: 'Ограничение данных',
      detail: limitation,
      status: 'risk' as const,
    })
  }
  const opportunities = overview.alerts
    .filter((alert) => alert.level === 'info')
    .slice(0, 8)
    .map((alert) => ({
      title: alert.title,
      detail: alert.description,
      status: 'opportunity' as const,
    }))

  if (overview.confidence === 'complete' && opportunities.length === 0) {
    opportunities.push({
      title: 'Полный фактический контур',
      detail: 'Продажи, остатки и прайс опубликованы и готовы для постановки измеримой Точки B.',
      status: 'opportunity' as const,
    })
  }
  return { risks, opportunities }
}

function alertNote(alert: StoreAlert) {
  return {
    title: alert.title,
    detail: alert.description,
    status: 'risk' as const,
  }
}

function buildNextAction(overview: StoreOverview) {
  const missing = [
    !overview.availability.sales ? 'продажи' : null,
    !overview.availability.inventory ? 'остатки' : null,
    !overview.availability.prices ? 'прайс' : null,
  ].filter((value): value is string => Boolean(value))
  const alert = overview.alerts[0]

  if (missing.length > 0) {
    return {
      id: 'roadmap:store:complete-data',
      title: 'Завершить фактический контур',
      description: `Опубликовать недостающие источники: ${missing.join(', ')}.`,
      horizon: 'Следующий шаг',
      progress: Math.round(((3 - missing.length) / 3) * 100),
      status: 'next' as const,
    }
  }
  if (alert) {
    return {
      id: 'roadmap:store:review-signal',
      title: alert.title,
      description: alert.description,
      horizon: 'Следующий управленческий разбор',
      progress: 0,
      status: 'next' as const,
    }
  }
  return {
    id: 'roadmap:store:define-goal',
    title: 'Задать измеримую Точку B',
    description: 'Выбрать показатель, целевое значение и срок на основе подтверждённой Точки A.',
    horizon: 'Решение владельца',
    progress: 0,
    status: 'next' as const,
  }
}

function metric(label: string, value: string | null, sourceLabel: string): Metric {
  return value === null
    ? { label, status: 'unknown', sourceLabel: 'Нужно подтвердить источник' }
    : { label, value, status: 'known', sourceLabel }
}

function money(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₸`
}

function nullableNumber(value: number | null): string | null {
  return value === null || !Number.isFinite(value) ? null : formatNumber(value, 3)
}

function nullableUnits(value: number | null): string | null {
  const formatted = nullableNumber(value)
  return formatted ? `${formatted} ед.` : null
}

function nullablePercent(value: number | null): string | null {
  return value === null || !Number.isFinite(value) ? null : formatPercent(value)
}

function storeSourceLabel(overview: StoreOverview): string {
  if (overview.source === 'operational') {
    return overview.versionLabel
      ? `Store Control Center · ${overview.versionLabel}`
      : 'Store Control Center · опубликованные отчёты'
  }
  if (overview.source === 'myhonor') return 'Store Control Center · MyHonor live'
  return 'Store Control Center · источник не подключён'
}

function widgetReason(kind: JourneyWidget['kind']): string {
  if (kind === 'finance_cashflow') return 'Опубликованные продажи дают проверяемую экономику периода.'
  if (kind === 'domain_metrics') return 'Опубликованные Store-агрегаты описывают текущий операционный масштаб.'
  if (kind === 'domain_process') return 'Readiness показывает, какие источники реально участвуют в расчётах.'
  return 'Store alerts и ограничения перенесены без генерации новых выводов.'
}
