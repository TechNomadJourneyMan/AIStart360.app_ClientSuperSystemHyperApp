import { prisma } from '@/lib/db'

// ============================================================
// Period-scoped facts behind the analytics KPIs.
//
// `lib/analytics-data.ts` returns the headline numbers only, and it has no
// notion of a period and never selects report dates. Everything the drill-down
// needs to answer "where does this number come from" lives here: dated trend
// points, the previous-period comparison, and the data-coverage counters that
// tell the user which clients are missing input.
//
// All queries are aggregates or bounded fetches — no extra org-wide row dumps.
// ============================================================

export const ANALYTICS_PERIODS = [
  { id: '7d', label: '7 дней', days: 7, genitive: '7 дней' },
  { id: '30d', label: '30 дней', days: 30, genitive: '30 дней' },
  { id: '90d', label: '90 дней', days: 90, genitive: '90 дней' },
  { id: '12m', label: '12 месяцев', days: 365, genitive: '12 месяцев' },
] as const

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]
export type AnalyticsPeriodId = AnalyticsPeriod['id']

export const DEFAULT_PERIOD_ID: AnalyticsPeriodId = '30d'

export function parsePeriodId(raw: string | string[] | undefined): AnalyticsPeriodId {
  const value = Array.isArray(raw) ? raw[0] : raw
  const match = ANALYTICS_PERIODS.find((period) => period.id === value)
  return match ? match.id : DEFAULT_PERIOD_ID
}

export function getPeriod(id: AnalyticsPeriodId): AnalyticsPeriod {
  return ANALYTICS_PERIODS.find((period) => period.id === id) ?? ANALYTICS_PERIODS[1]
}

export type TrendPoint = {
  /** ISO timestamp of `gri_reports.calculated_at` */
  date: string
  /** raw 0..100 score as stored */
  raw: number
  /** 0..1000 score as shown across the portal */
  display: number
}

export type AnalyticsDetail = {
  period: { id: AnalyticsPeriodId; label: string; days: number; from: string; to: string }
  gri: {
    avgDisplay: number | null
    previousAvgDisplay: number | null
    deltaPercent: number | null
    reportCount: number
    previousReportCount: number
    minDisplay: number | null
    maxDisplay: number | null
    lastReportAt: string | null
    clientsWithGri: number
  }
  trend: TrendPoint[]
  clients: {
    total: number
    statusCounts: Array<{ status: string; count: number }>
  }
  avgCheck: {
    filled: number
    missing: number
    top: Array<{ id: string; name: string; value: number }>
    missingSample: Array<{ id: string; name: string }>
  }
  /** How many clients sit in each industry — used to explain the industry bars. */
  industryClientCounts: Array<{ industry: string; clients: number }>
}

const TREND_POINT_LIMIT = 60

/**
 * How many GRI reports each of these clients has.
 *
 * `lib/analytics-data.ts:111` falls back to `score ?? 0`, so "no report yet" and
 * "scored zero" arrive at the table as the same number — and `toStatus(0)` then
 * labels an unmeasured client «Критично». The row count is the only way to tell
 * the two apart, and it also says whether the growth column has anything to
 * compare (it needs two reports).
 */
export async function getGriReportCounts(clientIds: string[]): Promise<Record<string, number>> {
  if (clientIds.length === 0) return {}

  const groups = await prisma.griReport.groupBy({
    by: ['clientId'],
    where: { clientId: { in: clientIds } },
    _count: { _all: true },
  })

  const counts: Record<string, number> = {}
  for (const id of clientIds) counts[id] = 0
  for (const group of groups) counts[String(group.clientId)] = group._count._all
  return counts
}

export async function getAnalyticsDetail(periodId: AnalyticsPeriodId): Promise<AnalyticsDetail> {
  const period = getPeriod(periodId)
  const to = new Date()
  const from = new Date(to.getTime() - period.days * 24 * 60 * 60 * 1000)
  const previousFrom = new Date(from.getTime() - period.days * 24 * 60 * 60 * 1000)

  const [
    currentAggregate,
    previousAggregate,
    trendRows,
    totalClients,
    statusGroups,
    clientsWithGri,
    filledAvgCheck,
    topAvgCheck,
    missingAvgCheckSample,
    industryGroups,
  ] = await Promise.all([
    prisma.griReport.aggregate({
      where: { calculatedAt: { gte: from } },
      _avg: { score: true },
      _min: { score: true },
      _max: { score: true, calculatedAt: true },
      _count: { _all: true },
    }),
    prisma.griReport.aggregate({
      where: { calculatedAt: { gte: previousFrom, lt: from } },
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.griReport.findMany({
      where: { calculatedAt: { gte: from } },
      orderBy: { calculatedAt: 'desc' },
      take: TREND_POINT_LIMIT,
      select: { score: true, calculatedAt: true },
    }),
    prisma.client.count(),
    prisma.client.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.client.count({ where: { griReports: { some: {} } } }),
    prisma.client.count({ where: { pulseMetrics: { avgCheck: { gt: 0 } } } }),
    prisma.pulseMetric.findMany({
      where: { avgCheck: { gt: 0 } },
      orderBy: { avgCheck: 'desc' },
      take: 5,
      select: { avgCheck: true, client: { select: { id: true, name: true } } },
    }),
    prisma.client.findMany({
      where: {
        OR: [{ pulseMetrics: { is: null } }, { pulseMetrics: { avgCheck: { lte: 0 } } }],
      },
      orderBy: { name: 'asc' },
      take: 8,
      select: { id: true, name: true },
    }),
    prisma.client.groupBy({ by: ['industry'], _count: { _all: true } }),
  ])

  const avgRaw = currentAggregate._avg.score
  const previousAvgRaw = previousAggregate._avg.score
  const avgDisplay = avgRaw === null ? null : Math.round(avgRaw * 10)
  const previousAvgDisplay = previousAvgRaw === null ? null : Math.round(previousAvgRaw * 10)

  const deltaPercent =
    avgRaw !== null && previousAvgRaw !== null && previousAvgRaw !== 0
      ? Math.round(((avgRaw - previousAvgRaw) / previousAvgRaw) * 1000) / 10
      : null

  const trend: TrendPoint[] = trendRows
    .slice()
    .reverse()
    .map((row) => ({
      date: row.calculatedAt.toISOString(),
      raw: Math.max(0, Math.min(100, row.score)),
      display: Math.round(row.score * 10),
    }))

  return {
    period: {
      id: period.id,
      label: period.label,
      days: period.days,
      from: from.toISOString(),
      to: to.toISOString(),
    },
    gri: {
      avgDisplay,
      previousAvgDisplay,
      deltaPercent,
      reportCount: currentAggregate._count._all,
      previousReportCount: previousAggregate._count._all,
      minDisplay: currentAggregate._min.score === null ? null : Math.round(currentAggregate._min.score * 10),
      maxDisplay: currentAggregate._max.score === null ? null : Math.round(currentAggregate._max.score * 10),
      lastReportAt: currentAggregate._max.calculatedAt?.toISOString() ?? null,
      clientsWithGri,
    },
    trend,
    clients: {
      total: totalClients,
      statusCounts: statusGroups
        .map((group) => ({ status: String(group.status), count: group._count._all }))
        .sort((a, b) => b.count - a.count),
    },
    avgCheck: {
      filled: filledAvgCheck,
      missing: Math.max(0, totalClients - filledAvgCheck),
      top: topAvgCheck.map((row) => ({ id: row.client.id, name: row.client.name, value: row.avgCheck })),
      missingSample: missingAvgCheckSample,
    },
    industryClientCounts: industryGroups.map((group) => ({
      industry: String(group.industry),
      clients: group._count._all,
    })),
  }
}
