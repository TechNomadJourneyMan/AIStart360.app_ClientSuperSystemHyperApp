export interface StoreMonthlyRevenueFact {
  kind: 'store_monthly'
  monthlyRevenue: number
  annualRunRate: number
  period: { from: string; to: string }
  periodLabel: string
  scopeKey: string
  publishedAt: string | null
  source: string
}

export interface StorePendingPeriod {
  period: { from: string; to: string }
  periodLabel: string
  scopeKey: string
  publishedAt: string | null
  source: string
}

export interface AnnualRevenueFact {
  kind: 'annual_average'
  monthlyRevenue: number
  annualRevenue: number
}

export type GrowthRevenueFact = StoreMonthlyRevenueFact | AnnualRevenueFact | null

const RU_MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finiteMoney(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function monthEnd(month: string): string | null {
  const match = month.match(/^(20\d{2})-(0[1-9]|1[0-2])$/)
  if (!match) return null
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

function calendarDateInAlmaty(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? value
    : null
}

export function russianMonthPeriodLabel(from: string, to: string): string | null {
  const match = from.match(/^(20\d{2})-(0[1-9]|1[0-2])-01$/)
  if (!match) return null
  const month = `${match[1]}-${match[2]}`
  if (monthEnd(month) !== to) return null
  return `${RU_MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

function storeAnalytics(payload: unknown): Record<string, unknown> | null {
  const envelope = record(payload)
  if (envelope?.ok !== true) return null
  const data = record(envelope.data)
  const analytics = record(data?.analytics)
  return analytics?.schemaVersion === 2 ? analytics : null
}

function storeCandidates(analytics: Record<string, unknown>): Record<string, unknown>[] {
  const windows = record(analytics.windows)
  const history = Array.isArray(analytics.history) ? analytics.history : []
  return [
    record(windows?.latestPublished),
    ...history.map(record).filter((item): item is Record<string, unknown> => item !== null).reverse(),
  ].filter((item): item is Record<string, unknown> => item !== null)
}

function validatedStorePeriod(candidate: Record<string, unknown>): StorePendingPeriod | null {
  const period = record(candidate.period)
  const from = typeof period?.from === 'string' ? period.from : ''
  const to = typeof period?.to === 'string' ? period.to : ''
  const periodLabel = russianMonthPeriodLabel(from, to)
  if (!periodLabel) return null

  const scopeKey = typeof candidate.scopeKey === 'string' ? candidate.scopeKey : ''
  if (scopeKey !== `month:${from.slice(0, 7)}`) return null

  const source = typeof candidate.source === 'string' ? candidate.source : ''
  if (!['financial_report', 'operational', 'mixed'].includes(source)) return null

  return {
    period: { from, to },
    periodLabel,
    scopeKey,
    publishedAt: typeof candidate.publishedAt === 'string' ? candidate.publishedAt : null,
    source,
  }
}

/**
 * Reads only a complete, explicitly published Store month. Observed MyHonor
 * events and partial periods are intentionally rejected: absence of a complete
 * watermark must never be presented as a monthly fact.
 */
export function parseStoreMonthlyRevenue(
  payload: unknown,
  now: Date = new Date(),
): StoreMonthlyRevenueFact | null {
  const analytics = storeAnalytics(payload)
  if (!analytics) return null
  // Prefer the server's analytics clock. A skewed browser clock must not turn
  // an open month into a closed fact; `now` remains only a fallback/test seam.
  const currentDate = calendarDate(analytics.currentDate) ?? calendarDateInAlmaty(now)
  if (!currentDate) return null

  for (const candidate of storeCandidates(analytics)) {
    if (candidate.coverage !== 'complete') continue
    const metadata = validatedStorePeriod(candidate)
    if (!metadata || metadata.period.to >= currentDate) continue
    const metrics = record(candidate.metrics)
    const monthlyRevenue = finiteMoney(metrics?.revenue)
    if (monthlyRevenue === null) continue
    return {
      kind: 'store_monthly',
      monthlyRevenue,
      annualRunRate: Math.round(monthlyRevenue * 12),
      ...metadata,
    }
  }
  return null
}

/** Latest uploaded Store month that is visible but not yet a closed KPI fact. */
export function parseLatestStorePendingPeriod(payload: unknown): StorePendingPeriod | null {
  const analytics = storeAnalytics(payload)
  if (!analytics) return null
  for (const candidate of storeCandidates(analytics)) {
    if (candidate.coverage !== 'partial') continue
    const metadata = validatedStorePeriod(candidate)
    if (metadata) return metadata
  }
  return null
}

/** Store monthly fact wins; annual Point A remains a clearly-labelled fallback. */
export function selectGrowthRevenue(
  storePayload: unknown,
  annualRevenue: number | null | undefined,
): GrowthRevenueFact {
  const store = parseStoreMonthlyRevenue(storePayload)
  if (store) return store
  if (typeof annualRevenue !== 'number' || !Number.isFinite(annualRevenue) || annualRevenue < 0) {
    return null
  }
  return {
    kind: 'annual_average',
    annualRevenue,
    monthlyRevenue: Math.round(annualRevenue / 12),
  }
}
