import { calculateSalesMetrics } from './metrics'
import type {
  StoreAnalytics,
  StoreAnalyticsCoverage,
  StoreAnalyticsMonth,
  StoreAnalyticsPeriod,
  StoreAnalyticsSlice,
  StoreAnalyticsSource,
  StoreDomainFreshness,
  StorePnlPeriod,
  StoreSalesFact,
  StoreSalesMetrics,
} from './types'

export const STORE_ANALYTICS_TIMEZONE = 'Asia/Almaty' as const

export interface StoreOperationalAnalyticsPeriod {
  scopeKey: string
  periodStart: string | null
  periodEnd: string | null
  publishedAt: string
  facts: StoreSalesFact[]
}

export interface StoreFinancialAnalyticsPeriod {
  month: string
  revenue: number | null
  costAmount: number | null
  reportedGrossProfit: number | null
  periodExpenses: number | null
  bonuses: number | null
  writeOffs: number | null
  ebitda: number | null
  completeness: 'complete' | 'partial' | 'provisional'
  note: string | null
  scopeKey: string
  sourceSheet: string | null
  publishedAt: string
}

export interface BuildStoreAnalyticsInput {
  now?: Date
  operationalPeriods: StoreOperationalAnalyticsPeriod[]
  myHonorFacts: StoreSalesFact[]
  myHonorSyncedAt: string | null
  financialPeriods?: StoreFinancialAnalyticsPeriod[]
  financialSchemaAvailable?: boolean
  operationalUnavailable?: boolean
  operationalTruncated?: boolean
  freshness?: Partial<Record<'inventory' | 'prices' | 'catalog', StoreDomainFreshness>>
}

export function calendarDateInAlmaty(value: string | Date): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STORE_ANALYTICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

function monthOf(value: string | Date): string | null {
  return calendarDateInAlmaty(value)?.slice(0, 7) ?? null
}

function monthPeriod(month: string): StoreAnalyticsPeriod {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function monthsBetween(period: StoreAnalyticsPeriod): string[] {
  const result: string[] = []
  const [startYear, startMonth] = period.from.slice(0, 7).split('-').map(Number)
  const [endYear, endMonth] = period.to.slice(0, 7).split('-').map(Number)
  let cursor = startYear * 12 + startMonth - 1
  const end = endYear * 12 + endMonth - 1
  while (cursor <= end && result.length < 240) {
    const year = Math.floor(cursor / 12)
    const month = cursor % 12 + 1
    result.push(`${year}-${String(month).padStart(2, '0')}`)
    cursor += 1
  }
  return result
}

function maxDate(left: string, right: string): string {
  return left > right ? left : right
}

function minDate(left: string, right: string): string {
  return left < right ? left : right
}

function latestText(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((current, value) => {
    if (!value) return current
    return !current || value > current ? value : current
  }, null)
}

function zeroSalesMetrics(): StoreSalesMetrics {
  return {
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    grossMarginPct: null,
    listRevenue: 0,
    discount: 0,
    discountRatePct: null,
    units: 0,
    returns: 0,
  }
}

function emptySalesMetrics(): StoreSalesMetrics {
  return calculateSalesMetrics([])
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return Math.round((((current - previous) / Math.abs(previous)) * 100 + Number.EPSILON) * 100) / 100
}

function metricsFromFinancial(period: StoreFinancialAnalyticsPeriod): StoreSalesMetrics {
  const grossProfit = period.revenue === null || period.costAmount === null
    ? null
    : roundMoney(period.revenue - period.costAmount)
  return {
    revenue: period.revenue,
    cost: period.costAmount,
    grossProfit,
    grossMarginPct: grossProfit === null || period.revenue === null || period.revenue === 0
      ? null
      : Math.round(((grossProfit / period.revenue) * 100 + Number.EPSILON) * 100) / 100,
    listRevenue: null,
    discount: null,
    discountRatePct: null,
    units: null,
    returns: null,
  }
}

function coverageFromFinancial(period: StoreFinancialAnalyticsPeriod): StoreAnalyticsCoverage {
  const metrics = metricsFromFinancial(period)
  return period.completeness === 'complete'
    && metrics.revenue !== null
    && metrics.cost !== null
    ? 'complete'
    : 'partial'
}

function sumKnown(values: Array<number | null>, rounded = false): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  return rounded ? roundMoney(total) : total
}

function aggregateSalesMetrics(parts: StoreSalesMetrics[]): StoreSalesMetrics {
  if (parts.length === 0) return emptySalesMetrics()
  const revenue = sumKnown(parts.map((part) => part.revenue), true)
  const cost = sumKnown(parts.map((part) => part.cost), true)
  const grossProfit = sumKnown(parts.map((part) => part.grossProfit), true)
  const listRevenue = sumKnown(parts.map((part) => part.listRevenue), true)
  const discount = sumKnown(parts.map((part) => part.discount), true)
  return {
    revenue,
    cost,
    grossProfit,
    grossMarginPct: revenue === null || revenue === 0 || grossProfit === null
      ? null
      : Math.round(((grossProfit / revenue) * 100 + Number.EPSILON) * 100) / 100,
    listRevenue,
    discount,
    discountRatePct: listRevenue === null || listRevenue === 0 || discount === null
      ? null
      : Math.round(((discount / listRevenue) * 100 + Number.EPSILON) * 100) / 100,
    units: sumKnown(parts.map((part) => part.units)),
    returns: sumKnown(parts.map((part) => part.returns)),
  }
}

export function statusForPointInTime(lastFactAt: string | null, currentDate: string): StoreAnalyticsCoverage {
  if (!lastFactAt) return 'not_covered'
  const factDate = calendarDateInAlmaty(lastFactAt)
  if (!factDate) return 'unavailable'
  return factDate >= currentDate ? 'complete' : 'stale'
}

/** Pure owner-independent projection used by both the page and API DTO. */
export function buildStoreAnalytics(input: BuildStoreAnalyticsInput): StoreAnalytics {
  const now = input.now ? new Date(input.now.getTime()) : new Date()
  const generatedAt = now.toISOString()
  const currentDate = calendarDateInAlmaty(now) ?? generatedAt.slice(0, 10)
  const currentMonth = currentDate.slice(0, 7)
  const currentYear = Number(currentDate.slice(0, 4))
  const previousYear = currentYear - 1

  const operationalByMonth = new Map<string, StoreOperationalAnalyticsPeriod>()
  for (const period of input.operationalPeriods) {
    const scopeMonth = /^month:\d{4}-\d{2}$/.test(period.scopeKey)
      ? period.scopeKey.slice('month:'.length)
      : monthOf(period.periodEnd ?? period.periodStart ?? period.facts[0]?.occurredOn ?? '')
    if (!scopeMonth) continue
    const current = operationalByMonth.get(scopeMonth)
    if (!current || period.publishedAt > current.publishedAt) {
      operationalByMonth.set(scopeMonth, period)
    }
  }

  const myHonorByMonth = new Map<string, StoreSalesFact[]>()
  for (const fact of input.myHonorFacts) {
    const month = monthOf(fact.occurredOn)
    if (!month || operationalByMonth.has(month)) continue
    const current = myHonorByMonth.get(month) ?? []
    current.push(fact)
    myHonorByMonth.set(month, current)
  }

  const financialByMonth = new Map<string, StoreFinancialAnalyticsPeriod>()
  for (const period of input.financialPeriods ?? []) {
    if (!/^\d{4}-\d{2}$/.test(period.month)) continue
    const current = financialByMonth.get(period.month)
    if (!current || period.publishedAt > current.publishedAt) {
      financialByMonth.set(period.month, period)
    }
  }

  function sliceForRange(
    key: StoreAnalyticsSlice['key'],
    period: StoreAnalyticsPeriod,
  ): StoreAnalyticsSlice {
    const metricParts: StoreSalesMetrics[] = []
    const sources = new Set<Exclude<StoreAnalyticsSource, 'mixed' | 'none'>>()
    const scopeKeys: string[] = []
    const publishedDates: string[] = []
    const factDates: string[] = []
    let everyPartComplete = true
    let hasContribution = false
    let usedOperational = false
    let usedMyHonor = false

    for (const month of monthsBetween(period)) {
      const monthBounds = monthPeriod(month)
      const requestedInMonth = {
        from: maxDate(period.from, monthBounds.from),
        to: minDate(period.to, monthBounds.to),
      }
      const operational = operationalByMonth.get(month)
      if (operational) {
        usedOperational = true
        hasContribution = true
        sources.add('operational')
        scopeKeys.push(operational.scopeKey)
        publishedDates.push(operational.publishedAt)
        const facts = operational.facts.filter((fact) => {
          const date = calendarDateInAlmaty(fact.occurredOn)
          return Boolean(date && date >= requestedInMonth.from && date <= requestedInMonth.to)
        })
        const runFrom = operational.periodStart
          ? calendarDateInAlmaty(operational.periodStart)
          : null
        const runTo = operational.periodEnd
          ? calendarDateInAlmaty(operational.periodEnd)
          : null
        const complete = Boolean(
          runFrom
          && runTo
          && runFrom <= requestedInMonth.from
          && runTo >= requestedInMonth.to,
        )
        everyPartComplete = everyPartComplete && complete
        metricParts.push(facts.length > 0 ? calculateSalesMetrics(facts) : complete ? zeroSalesMetrics() : emptySalesMetrics())
        factDates.push(...facts.map((fact) => fact.occurredOn))
        continue
      }

      const financial = financialByMonth.get(month)
      if (financial) {
        // A management row is a calendar-month aggregate. It is valid for a
        // full-month/YTD window, never as a made-up daily or MTD breakdown.
        if (requestedInMonth.from === monthBounds.from && requestedInMonth.to === monthBounds.to) {
          hasContribution = true
          sources.add('financial_report')
          scopeKeys.push(financial.scopeKey)
          publishedDates.push(financial.publishedAt)
          factDates.push(monthBounds.to)
          metricParts.push(metricsFromFinancial(financial))
          everyPartComplete = everyPartComplete && coverageFromFinancial(financial) === 'complete'
        } else {
          everyPartComplete = false
        }
        continue
      }

      const observed = myHonorByMonth.get(month) ?? []
      if (observed.length > 0) {
        usedMyHonor = true
        hasContribution = true
        sources.add('myhonor')
        const facts = observed.filter((fact) => {
          const date = calendarDateInAlmaty(fact.occurredOn)
          return Boolean(date && date >= requestedInMonth.from && date <= requestedInMonth.to)
        })
        if (facts.length > 0) {
          metricParts.push(calculateSalesMetrics(facts))
          factDates.push(...facts.map((fact) => fact.occurredOn))
        }
        everyPartComplete = false
      } else {
        everyPartComplete = false
      }
    }

    let coverage: StoreAnalyticsCoverage
    if (input.operationalUnavailable && usedOperational) {
      coverage = 'unavailable'
    } else if (input.operationalTruncated && usedOperational) {
      coverage = 'unavailable'
    } else if (hasContribution && everyPartComplete) {
      coverage = 'complete'
    } else if (hasContribution) {
      coverage = 'partial'
    } else {
      const syncDate = input.myHonorSyncedAt
        ? calendarDateInAlmaty(input.myHonorSyncedAt)
        : null
      coverage = syncDate && syncDate < period.to ? 'stale' : 'not_covered'
    }

    const source: StoreAnalyticsSource = sources.size > 1
      ? 'mixed'
      : Array.from(sources)[0]
        ?? (coverage === 'stale' && input.myHonorSyncedAt ? 'myhonor' : 'none')
    const metrics = coverage === 'unavailable'
      ? emptySalesMetrics()
      : aggregateSalesMetrics(metricParts)
    const uniqueScopes = Array.from(new Set(scopeKeys)).sort()
    const message = coverage === 'complete'
      ? null
      : coverage === 'partial'
        ? 'Показаны подтверждённые и наблюдаемые факты; полного покрытия всего периода нет.'
        : coverage === 'stale'
          ? 'Источник не подтверждал новые факты в этом периоде. Отсутствие строк не считается нулевой выручкой.'
          : coverage === 'unavailable'
            ? 'Агрегат недоступен или превышен безопасный лимит. Неполная сумма не показывается.'
            : 'Для периода нет опубликованного отчёта или подтверждённого watermark полноты.'

    return {
      key,
      period,
      coverage,
      source,
      scopeKey: uniqueScopes.length === 1 ? uniqueScopes[0] : null,
      scopeKeys: uniqueScopes,
      lastFactAt: latestText(factDates),
      publishedAt: latestText(publishedDates),
      syncedAt: usedMyHonor || (coverage === 'stale' && source === 'myhonor')
        ? input.myHonorSyncedAt
        : null,
      metrics,
      message,
    }
  }

  const today = sliceForRange('today', { from: currentDate, to: currentDate })
  const monthToDate = sliceForRange('monthToDate', {
    from: `${currentMonth}-01`,
    to: currentDate,
  })

  const reportMonths = Array.from(new Set([
    ...operationalByMonth.keys(),
    ...financialByMonth.keys(),
  ])).sort()
  const publishedMonths = reportMonths.length > 0
    ? reportMonths
    : Array.from(myHonorByMonth.keys()).sort()
  const latestMonth = publishedMonths.at(-1) ?? currentMonth
  const latestPeriodSource = operationalByMonth.get(latestMonth)
  const latestPeriod = latestPeriodSource?.periodStart && latestPeriodSource.periodEnd
    ? {
        from: calendarDateInAlmaty(latestPeriodSource.periodStart) ?? monthPeriod(latestMonth).from,
        to: calendarDateInAlmaty(latestPeriodSource.periodEnd) ?? monthPeriod(latestMonth).to,
      }
    : monthPeriod(latestMonth)
  const latestPublished = sliceForRange('latestPublished', latestPeriod)

  // YTD is comparable through the latest closed month represented by a
  // published operational or management period. The current uncovered month
  // remains visible in the separate MTD selector and is never inferred as 0.
  const lastClosedMonthDate = new Date(Date.UTC(currentYear, Number(currentMonth.slice(5, 7)) - 1, 0))
  const lastClosedMonth = lastClosedMonthDate.toISOString().slice(0, 7)
  const latestClosedCurrentYearMonth = Array.from(new Set([
    ...operationalByMonth.keys(),
    ...financialByMonth.keys(),
  ]))
    .filter((month) => month.startsWith(`${currentYear}-`) && month <= lastClosedMonth)
    .sort()
    .at(-1)
  const ytdTo = latestClosedCurrentYearMonth
    ? monthPeriod(latestClosedCurrentYearMonth).to
    : currentDate
  const yearToDate = sliceForRange('yearToDate', {
    from: `${currentYear}-01-01`,
    to: ytdTo,
  })
  const previousYearWindow = sliceForRange('previousYear', {
    from: `${previousYear}-01-01`,
    to: `${previousYear}-12-31`,
  })
  const previousComparable = sliceForRange('previousYear', {
    from: `${previousYear}-01-01`,
    to: `${previousYear}-${ytdTo.slice(5)}`,
  })

  const historyMonths = new Set<string>([
    ...operationalByMonth.keys(),
    ...myHonorByMonth.keys(),
    ...financialByMonth.keys(),
  ])
  const history: StoreAnalyticsMonth[] = Array.from(historyMonths)
    .sort()
    .map((month) => {
      const full = monthPeriod(month)
      return {
        ...sliceForRange(`month:${month}`, full),
        key: `month:${month}` as const,
        month,
      }
    })

  const pnlPeriods = history.flatMap<StorePnlPeriod>((historyPeriod): StorePnlPeriod[] => {
    const financial = financialByMonth.get(historyPeriod.month)
    const hasPublishedPnlBundle = financial?.reportedGrossProfit !== null
      && financial?.reportedGrossProfit !== undefined
      && financial.periodExpenses !== null
      && financial.ebitda !== null
    if (financial && hasPublishedPnlBundle) {
      const derivedGrossProfit = financial.revenue === null || financial.costAmount === null
        ? null
        : roundMoney(financial.revenue - financial.costAmount)
      const grossProfit = financial.reportedGrossProfit ?? derivedGrossProfit
      // Bonuses and write-offs are disclosure lines within periodExpenses;
      // subtracting them again would double-count expenses.
      const ebitda = financial.ebitda
        ?? (grossProfit !== null && financial.periodExpenses !== null
          ? roundMoney(grossProfit - financial.periodExpenses)
          : null)
      const completeEbitda = financial.completeness === 'complete'
        && financial.revenue !== null
        && financial.costAmount !== null
        && grossProfit !== null
        && financial.periodExpenses !== null
        && ebitda !== null
      return [{
        month: historyPeriod.month,
        coverage: completeEbitda ? 'complete' as const : 'partial' as const,
        source: 'financial_report' as const,
        scopeKey: financial.scopeKey,
        sourceSheet: financial.sourceSheet,
        publishedAt: financial.publishedAt,
        revenue: financial.revenue,
        costAmount: financial.costAmount,
        grossProfit,
        periodExpenses: financial.periodExpenses,
        bonuses: financial.bonuses,
        writeOffs: financial.writeOffs,
        ebitda,
        note: financial.note,
      }]
    }
    if (input.financialSchemaAvailable !== false || historyPeriod.metrics.revenue === null) return []
    return [{
      month: historyPeriod.month,
      coverage: 'partial' as const,
      source: 'sales_fallback' as const,
      scopeKey: historyPeriod.scopeKey,
      sourceSheet: null,
      publishedAt: historyPeriod.publishedAt,
      revenue: historyPeriod.metrics.revenue,
      costAmount: historyPeriod.metrics.cost,
      grossProfit: historyPeriod.metrics.grossProfit,
      periodExpenses: null,
      bonuses: null,
      writeOffs: null,
      ebitda: null,
      note: 'Расходы периода, бонусы и списания не опубликованы.',
    }]
  })
  const pnlCoverage: StoreAnalyticsCoverage = pnlPeriods.length === 0
    ? input.financialSchemaAvailable === false ? 'unavailable' : 'not_covered'
    : pnlPeriods.every((period) => period.coverage === 'complete')
      ? 'complete'
      : 'partial'
  const hasNegativeEbitda = pnlPeriods.some((period) => period.ebitda !== null && period.ebitda < 0)
  const comparable = yearToDate.coverage === 'complete'
    && previousComparable.coverage === 'complete'
    && yearToDate.metrics.revenue !== null
    && previousComparable.metrics.revenue !== null

  const latestOperationalFact = latestText(
    input.operationalPeriods.flatMap((period) => period.facts.map((fact) => fact.occurredOn)),
  )
  const latestMyHonorFact = latestText(input.myHonorFacts.map((fact) => fact.occurredOn))
  const latestFinancialFact = latestText(
    Array.from(financialByMonth.keys()).map((month) => monthPeriod(month).to),
  )
  const trustedSalesLastFact = latestText([latestOperationalFact, latestFinancialFact])
  const salesLastFact = latestText([trustedSalesLastFact, latestMyHonorFact])
  const trustedSalesCoverage = statusForPointInTime(trustedSalesLastFact, currentDate)
  const observedSalesCoverage = statusForPointInTime(latestMyHonorFact, currentDate)
  const salesCoverage: StoreAnalyticsCoverage = trustedSalesCoverage === 'complete'
    ? 'complete'
    : observedSalesCoverage === 'complete'
      // MyHonor exposes observed events, but has no completeness watermark.
      // A current event proves activity, not a complete day or month.
      ? 'partial'
      : trustedSalesCoverage === 'unavailable'
        ? 'unavailable'
        : observedSalesCoverage === 'unavailable'
          ? 'unavailable'
          : trustedSalesCoverage === 'stale' || observedSalesCoverage === 'stale'
            ? 'stale'
            : 'not_covered'
  const salesPublishedAt = latestText([
    ...input.operationalPeriods.map((period) => period.publishedAt),
    ...Array.from(financialByMonth.values()).map((period) => period.publishedAt),
  ])
  const defaultFreshness: StoreDomainFreshness = {
    coverage: 'not_covered',
    lastFactAt: null,
    publishedAt: null,
    syncedAt: null,
  }
  const limitations: string[] = []
  if (input.myHonorSyncedAt) {
    limitations.push('MyHonor содержит наблюдаемые события без watermark полноты; пустой период не считается нулём.')
  }
  if (input.financialSchemaAvailable === false) {
    limitations.push('Расширенный финансовый импорт ещё не опубликован; P&L собран только из доступных продаж.')
  }
  if (input.operationalTruncated) {
    limitations.push('Операционный объём превысил безопасный лимит; неполные финансовые суммы скрыты.')
  }

  return {
    schemaVersion: 2,
    timezone: STORE_ANALYTICS_TIMEZONE,
    generatedAt,
    currentDate,
    windows: {
      today,
      monthToDate,
      latestPublished,
      yearToDate,
      previousYear: previousYearWindow,
    },
    history,
    comparableYtd: {
      currentYear,
      previousYear,
      current: yearToDate,
      previous: previousComparable,
      revenueChangePct: comparable
        ? percentChange(yearToDate.metrics.revenue, previousComparable.metrics.revenue)
        : null,
      grossProfitChangePct: comparable
        ? percentChange(yearToDate.metrics.grossProfit, previousComparable.metrics.grossProfit)
        : null,
      comparable,
      message: comparable
        ? null
        : 'Сопоставимое YTD-сравнение недоступно: один из периодов не имеет полного подтверждённого покрытия.',
    },
    pnl: {
      coverage: pnlCoverage,
      periods: pnlPeriods,
      hasNegativeEbitda,
      message: input.financialSchemaAvailable === false
        ? 'Финансовая схема ещё не доступна; расходы и EBITDA не достраиваются предположениями.'
        : pnlCoverage === 'complete'
          ? null
          : pnlCoverage === 'not_covered'
            ? 'P&L для месяцев ещё не опубликован; базовые продажи не выдаются за P&L.'
            : 'P&L неполный: неизвестные статьи показаны прочерком; бонусы и списания уже входят в расходы периода.',
    },
    freshness: {
      sales: {
        coverage: input.operationalUnavailable || input.operationalTruncated
          ? 'unavailable'
          : salesCoverage,
        lastFactAt: salesLastFact,
        publishedAt: salesPublishedAt,
        syncedAt: input.myHonorSyncedAt,
      },
      inventory: input.freshness?.inventory ?? defaultFreshness,
      prices: input.freshness?.prices ?? defaultFreshness,
      catalog: input.freshness?.catalog ?? defaultFreshness,
    },
    limitations,
  }
}
