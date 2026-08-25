import { createEmptyJourneyState } from '@/lib/journey/demo'
import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyState,
  type JourneyWidget,
} from '@/lib/journey/schema'
import { formatDate, formatNumber, formatPercent, formatPeriod } from '@/lib/store/format'
import type {
  StoreAlert,
  StoreAnalytics,
  StoreAnalyticsCoverage,
  StoreAnalyticsPeriod,
  StoreAnalyticsSlice,
  StoreAnalyticsSource,
  StoreOverview,
} from '@/lib/store/types'

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
  const analytics = overview.source === 'empty' ? undefined : overview.analytics
  const source = storeSourceLabel(overview)
  const facts = analytics
    ? buildAnalyticsFacts(overview, analytics)
    : buildLegacyFacts(overview, source)
  const widgets = buildWidgets(overview, source, analytics)
  const nextAction = buildNextAction(overview, analytics)
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
          : `Точка A собрана из ${source}. Показатели не скопированы в Journey: это server read-only представление текущей публикации.`,
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
      label: 'Store · без копии в Journey',
    },
    serverRevision: 0,
    updatedAt: now,
  })
}

function buildAnalyticsFacts(
  overview: StoreOverview,
  analytics: StoreAnalytics,
): JourneyFact[] {
  const latest = analytics.windows.latestPublished
  const salesFreshness = analytics.freshness.sales
  const inventoryFreshness = analytics.freshness.inventory
  const latestSource = analyticsSliceSourceLabel(latest)
  const inventoryDate = datePart(inventoryFreshness.lastFactAt ?? overview.asOf)
    ?? latest.period.to
  const inventorySource = analyticsSourceLabel({
    source: overview.source === 'myhonor' ? 'myhonor' : 'operational',
    scopes: ['inventory'],
    period: { from: inventoryDate, to: inventoryDate },
    coverage: inventoryFreshness.coverage,
  })
  const freshnessSource = analyticsSliceSourceLabel(latest, salesFreshness.coverage)
  const confidence = latest.coverage === 'complete' ? 1 : 0.8
  const hasPublishedSalesWindow = latest.source !== 'none'
    && latest.coverage !== 'not_covered'
    && latest.coverage !== 'unavailable'
  const facts: JourneyFact[] = []
  const push = (
    id: string,
    label: string,
    value: string | null,
    category: JourneyFact['category'],
    sourceLabel: string,
    factConfidence: number,
  ) => {
    if (value === null) return
    facts.push(analyticsFact(id, label, value, category, sourceLabel, factConfidence))
  }

  if (hasPublishedSalesWindow) {
    push(
      'fact:store:period',
      'Фактический период',
      formatPeriod(latest.period),
      'sales',
      latestSource,
      confidence,
    )
    push(
      'fact:store:revenue',
      'Выручка',
      money(latest.metrics.revenue),
      'finance',
      latestSource,
      confidence,
    )
    push(
      'fact:store:gross-profit',
      'Валовая прибыль',
      money(latest.metrics.grossProfit),
      'finance',
      latestSource,
      confidence,
    )
    push(
      'fact:store:gross-margin',
      'Валовая маржа',
      nullablePercent(latest.metrics.grossMarginPct),
      'finance',
      latestSource,
      confidence,
    )
  }
  push(
    'fact:store:inventory',
    'Доступный остаток',
    nullableUnits(overview.inventory.availableUnits),
    'operations',
    inventorySource,
    inventoryFreshness.coverage === 'complete' ? 1 : 0.8,
  )
  push(
    'fact:store:freshness',
    'Свежесть данных',
    freshnessValue(salesFreshness),
    'operations',
    freshnessSource,
    salesFreshness.coverage === 'complete' ? 1 : 0.8,
  )
  return facts
}

function analyticsFact(
  id: string,
  label: string,
  value: string,
  category: JourneyFact['category'],
  sourceLabel: string,
  confidence: number,
): JourneyFact {
  return {
    id,
    label,
    value,
    category,
    sourceLabel,
    confidence,
    status: 'confirmed',
  }
}

function buildLegacyFacts(overview: StoreOverview, source: string): JourneyFact[] {
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

function buildWidgets(
  overview: StoreOverview,
  source: string,
  analytics?: StoreAnalytics,
): JourneyWidget[] {
  const salesSource = analytics
    ? analyticsSliceSourceLabel(analytics.windows.latestPublished)
    : source
  const inventorySource = analytics
    ? analyticsDomainSourceLabel(analytics, 'inventory', 'operational', analytics.windows.latestPublished.period.to)
    : source
  const catalogSource = analytics
    ? analyticsDomainSourceLabel(
        analytics,
        'catalog',
        analytics.freshness.catalog.syncedAt && !analytics.freshness.catalog.publishedAt
          ? 'myhonor'
          : 'operational',
        analytics.windows.latestPublished.period.to,
      )
    : source
  const financeMetrics = analytics
    ? buildAnalyticsFinanceMetrics(analytics)
    : [
        metric('Выручка', money(overview.metrics.revenue), source),
        metric('Себестоимость', money(overview.metrics.cost), source),
        metric('Валовая прибыль', money(overview.metrics.grossProfit), source),
        metric('Валовая маржа', nullablePercent(overview.metrics.grossMarginPct), source),
        metric('Скидки', money(overview.metrics.discount), source),
        metric('Доля скидок', nullablePercent(overview.metrics.discountRatePct), source),
      ]
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
      metrics: financeMetrics,
      sourceStatus: analytics
        ? ['complete', 'partial'].includes(analytics.windows.latestPublished.coverage)
          ? 'connected'
          : 'missing'
        : overview.availability.sales ? 'connected' : 'missing',
      nextQuestion: analytics && currentPeriodNeedsRecovery(analytics)
        ? currentPeriodRecoveryTitle(analytics)
        : overview.availability.sales
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
        metric('Продано единиц', nullableNumber(overview.metrics.units), salesSource),
        metric('Возвраты', nullableNumber(overview.metrics.returns), salesSource),
        metric('Доступно на складах', nullableUnits(overview.inventory.availableUnits), inventorySource),
        metric('Зарезервировано', nullableUnits(overview.inventory.reservedUnits), inventorySource),
        metric('Товаров в контуре', overview.catalog.products > 0 ? formatNumber(overview.catalog.products) : null, catalogSource),
        metric('Складов', overview.inventory.warehouses.length > 0 ? formatNumber(overview.inventory.warehouses.length) : null, inventorySource),
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

  const signals = splitSignals(overview, analytics)
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

function buildAnalyticsFinanceMetrics(analytics: StoreAnalytics): Metric[] {
  const latest = analytics.windows.latestPublished
  const latestMonth = monthLabel(latest.period.to.slice(0, 7))
  const latestSource = analyticsSliceSourceLabel(latest)
  const ytd = confirmedYtd(analytics)
  const ytdYear = latest.period.to.slice(0, 4)
  const ytdSource = ytd?.sourceLabel
    ?? analyticsSliceSourceLabel(analytics.windows.yearToDate)
  const ebitda = confirmedMayJulyEbitda(analytics, ytdYear)

  return [
    analyticsMetric(`Выручка · ${latestMonth}`, money(latest.metrics.revenue), latestSource),
    analyticsMetric(`Валовая прибыль · ${latestMonth}`, money(latest.metrics.grossProfit), latestSource),
    analyticsMetric(`Валовая маржа · ${latestMonth}`, nullablePercent(latest.metrics.grossMarginPct), latestSource),
    analyticsMetric(`Выручка YTD ${ytdYear}`, money(ytd?.revenue ?? null), ytdSource),
    analyticsMetric(`Валовая прибыль YTD ${ytdYear}`, money(ytd?.grossProfit ?? null), ytdSource),
    analyticsMetric(`EBITDA · май–июль ${ytdYear}`, money(ebitda.value), ebitda.sourceLabel),
  ]
}

function confirmedYtd(analytics: StoreAnalytics): {
  revenue: number
  grossProfit: number
  sourceLabel: string
} | null {
  const latest = analytics.windows.latestPublished
  const year = latest.period.to.slice(0, 4)
  const direct = analytics.windows.yearToDate
  if (
    direct.coverage === 'complete'
    && direct.period.from.startsWith(year)
    && direct.metrics.revenue !== null
    && direct.metrics.grossProfit !== null
  ) {
    return {
      revenue: direct.metrics.revenue,
      grossProfit: direct.metrics.grossProfit,
      sourceLabel: analyticsSliceSourceLabel(direct),
    }
  }

  const endMonth = latest.period.to.slice(0, 7)
  const expectedMonths = monthsThrough(year, endMonth)
  if (!expectedMonths.length) return null
  const historyByMonth = new Map(analytics.history.map((period) => [period.month, period]))
  const confirmed = expectedMonths.map((month) => historyByMonth.get(month))
  if (confirmed.some((period) => (
    !period
    || period.coverage !== 'complete'
    || period.metrics.revenue === null
    || period.metrics.grossProfit === null
  ))) return null

  const periods = confirmed.filter((period): period is NonNullable<typeof period> => Boolean(period))
  const sources = new Set(periods.map((period) => period.source))
  const source: StoreAnalyticsSource = sources.size === 1
    ? periods[0]?.source ?? 'none'
    : 'mixed'
  const scopes = periods.flatMap((period) => period.scopeKeys.length
    ? period.scopeKeys
    : period.scopeKey ? [period.scopeKey] : [])
  return {
    revenue: periods.reduce((sum, period) => sum + (period.metrics.revenue ?? 0), 0),
    grossProfit: periods.reduce((sum, period) => sum + (period.metrics.grossProfit ?? 0), 0),
    sourceLabel: analyticsSourceLabel({
      source,
      scopes,
      period: { from: `${year}-01-01`, to: latest.period.to },
      coverage: 'complete',
    }),
  }
}

function confirmedMayJulyEbitda(
  analytics: StoreAnalytics,
  year: string,
): { value: number | null; sourceLabel: string } {
  const months = [`${year}-05`, `${year}-06`, `${year}-07`]
  const byMonth = new Map(analytics.pnl.periods.map((period) => [period.month, period]))
  const periods = months.map((month) => byMonth.get(month))
  const complete = periods.every((period) => (
    period?.coverage === 'complete'
    && period.ebitda !== null
  ))
  const knownPeriods = periods.filter((period): period is NonNullable<typeof period> => Boolean(period))
  const sources = new Set(knownPeriods.map((period) => period.source))
  const source = sources.size === 1 ? knownPeriods[0]?.source ?? 'none' : 'mixed'
  const scopes = knownPeriods.flatMap((period) => period.scopeKey ? [period.scopeKey] : [])
  const sourceLabel = analyticsSourceLabel({
    source,
    scopes,
    period: { from: `${year}-05-01`, to: `${year}-07-31` },
    coverage: complete ? 'complete' : analytics.pnl.coverage,
  })

  // EBITDA is already a published direct P&L value. Summing it is deliberate:
  // recomputing GP - expenses - bonuses - write-offs here would subtract
  // bonuses/write-offs a second time for reports where expenses include them.
  return {
    value: complete
      ? knownPeriods.reduce((sum, period) => sum + (period.ebitda ?? 0), 0)
      : null,
    sourceLabel,
  }
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

function splitSignals(overview: StoreOverview, analytics?: StoreAnalytics) {
  const risks: Array<{ title: string; detail: string; status: 'risk' }> = []
  if (analytics && currentPeriodNeedsRecovery(analytics)) {
    const today = analytics.windows.today
    const monthToDate = analytics.windows.monthToDate
    risks.push({
      title: 'Текущий период не покрыт',
      detail: `Сегодня: ${today.coverage}; MTD: ${monthToDate.coverage}. Пустой период не считается нулевой выручкой.`,
      status: 'risk',
    })
  }
  if (analytics?.pnl.hasNegativeEbitda) {
    const negative = analytics.pnl.periods
      .filter((period) => period.ebitda !== null && period.ebitda < 0)
      .map((period) => `${monthLabel(period.month)}: ${money(period.ebitda)}`)
      .join(' · ')
    risks.push({
      title: 'Отрицательная EBITDA',
      detail: negative || 'В опубликованном P&L есть период с отрицательной EBITDA.',
      status: 'risk',
    })
  }
  for (const limitation of analytics?.limitations ?? []) {
    if (risks.length >= 8) break
    risks.push({
      title: 'Ограничение аналитики',
      detail: limitation,
      status: 'risk',
    })
  }
  for (const alert of overview.alerts
    .filter((alert) => alert.level !== 'info')
  ) {
    if (risks.length >= 8) break
    risks.push(alertNote(alert))
  }
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

  if (
    overview.confidence === 'complete'
    && opportunities.length === 0
    && (!analytics || !currentPeriodNeedsRecovery(analytics))
  ) {
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

function buildNextAction(overview: StoreOverview, analytics?: StoreAnalytics) {
  if (analytics && currentPeriodNeedsRecovery(analytics)) {
    return {
      id: 'roadmap:store:restore-current-period',
      title: currentPeriodRecoveryTitle(analytics),
      description: `Сегодня (${analytics.windows.today.coverage}) и MTD (${analytics.windows.monthToDate.coverage}) не имеют полного подтверждённого покрытия. Пустые окна не заменяются нулём.`,
      horizon: 'Следующий безопасный шаг',
      progress: 0,
      status: 'next' as const,
    }
  }
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

function analyticsMetric(label: string, value: string | null, sourceLabel: string): Metric {
  return value === null
    ? { label, status: 'unknown', sourceLabel }
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

function freshnessValue(freshness: StoreAnalytics['freshness']['sales']): string | null {
  if (!freshness.lastFactAt) return null
  const lastFact = `Последний факт: ${formatDate(freshness.lastFactAt)}`
  const published = freshness.publishedAt
    ? `опубликовано ${formatDate(freshness.publishedAt)}`
    : null
  return [lastFact, published, `покрытие: ${freshness.coverage}`]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
}

function analyticsSliceSourceLabel(
  slice: StoreAnalyticsSlice,
  coverage = slice.coverage,
): string {
  return analyticsSourceLabel({
    source: slice.source,
    scopes: slice.scopeKeys.length
      ? slice.scopeKeys
      : slice.scopeKey ? [slice.scopeKey] : [],
    period: slice.period,
    coverage,
  })
}

function analyticsDomainSourceLabel(
  analytics: StoreAnalytics,
  domain: keyof StoreAnalytics['freshness'],
  source: StoreAnalyticsSource,
  fallbackDate: string,
): string {
  const freshness = analytics.freshness[domain]
  const factDate = datePart(freshness.lastFactAt ?? freshness.syncedAt) ?? fallbackDate
  return analyticsSourceLabel({
    source,
    scopes: [domain],
    period: { from: factDate, to: factDate },
    coverage: freshness.coverage,
  })
}

function analyticsSourceLabel({
  source,
  scopes,
  period,
  coverage,
}: {
  source: string
  scopes: string[]
  period: StoreAnalyticsPeriod
  coverage: StoreAnalyticsCoverage
}): string {
  const uniqueScopes = [...new Set(scopes)]
  const scope = formatAnalyticsScopes(uniqueScopes)
  return `source=${source}; scope=${scope}; period=${period.from}..${period.to}; coverage=${coverage}`
}

function formatAnalyticsScopes(scopes: string[]): string {
  if (!scopes.length) return 'none'
  const sorted = [...scopes].sort()
  const monthScopes = sorted.filter((scope) => /^month:\d{4}-\d{2}$/.test(scope))
  if (monthScopes.length === sorted.length && monthScopes.length > 1) {
    const first = monthScopes[0]
    const last = monthScopes.at(-1)
    const expected = first && last
      ? monthsThrough(first.slice(6, 10), last.slice(6)).map((month) => `month:${month}`)
      : []
    if (expected.length === monthScopes.length && expected.every((scope, index) => scope === monthScopes[index])) {
      return `${first}..${last}`
    }
  }
  return sorted.join(',')
}

function currentPeriodNeedsRecovery(analytics: StoreAnalytics): boolean {
  return analytics.windows.today.coverage !== 'complete'
    || analytics.windows.monthToDate.coverage !== 'complete'
}

function currentPeriodRecoveryTitle(analytics: StoreAnalytics): string {
  return `Загрузить ${monthLabel(analytics.currentDate.slice(0, 7))} или обновить подключение`
}

function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  const parsed = new Date(`${month}-01T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return month
  return parsed.toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).replace(/\s+г\.$/, '')
}

function monthsThrough(year: string, endMonth: string): string[] {
  if (!/^\d{4}$/.test(year) || !new RegExp(`^${year}-\\d{2}$`).test(endMonth)) return []
  const end = Number(endMonth.slice(5, 7))
  if (end < 1 || end > 12) return []
  return Array.from({ length: end }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
}

function datePart(value: string | null | undefined): string | null {
  if (!value) return null
  const matched = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  return matched ?? null
}

function storeSourceLabel(overview: StoreOverview): string {
  if (overview.analytics && overview.source !== 'empty') {
    return analyticsSliceSourceLabel(overview.analytics.windows.latestPublished)
  }
  if (overview.source === 'operational') {
    return overview.versionLabel
      ? `Store Control Center · ${overview.versionLabel}`
      : 'Store Control Center · опубликованные отчёты'
  }
  if (overview.source === 'myhonor') {
    return 'Store Control Center · MyHonor · наблюдаемые заказы'
  }
  return 'Store Control Center · источник не подключён'
}

function widgetReason(kind: JourneyWidget['kind']): string {
  if (kind === 'finance_cashflow') return 'Опубликованные продажи дают проверяемую экономику периода.'
  if (kind === 'domain_metrics') return 'Опубликованные Store-агрегаты описывают текущий операционный масштаб.'
  if (kind === 'domain_process') return 'Readiness показывает, какие источники реально участвуют в расчётах.'
  return 'Store alerts и ограничения перенесены без генерации новых выводов.'
}
