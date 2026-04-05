import { prisma } from '@/lib/db'

type AnalyticsClientRow = {
  id: string
  name: string
  industry: string
  status: string
  pulseMetrics: {
    avgCheck: number
  } | null
  griReports: Array<{
    overallScore: number
  }>
}

type DbClient = {
  client: {
    count: (args?: unknown) => Promise<number>
    findMany: (args: unknown) => Promise<AnalyticsClientRow[]>
  }
  griReport: {
    aggregate: (args: unknown) => Promise<{ _avg: { overallScore: number | null } }>
    findMany: (args: unknown) => Promise<Array<{ overallScore: number }>>
  }
}

export type AnalyticsData = {
  kpis: {
    avgGriScore: number
    portfolioGmv: number
    activeClients: number
    churnRate: number
  }
  trend: number[]
  industryBreakdown: Array<{
    name: string
    value: number
  }>
  clientPerformance: Array<{
    id: string
    name: string
    industry: string
    gri: number
    gmv: number
    growth: number
    status: 'Strong' | 'Active' | 'Developing' | 'Critical'
  }>
}

function roundTo(number: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(number * factor) / factor
}

function toStatus(score: number): 'Strong' | 'Active' | 'Developing' | 'Critical' {
  if (score >= 80) return 'Strong'
  if (score >= 70) return 'Active'
  if (score >= 60) return 'Developing'
  return 'Critical'
}

export async function getAnalyticsData(db: DbClient = prisma as unknown as DbClient, orgId?: string): Promise<AnalyticsData> {
  const clientWhere = orgId ? { orgId } : undefined
  const reportsWhere = orgId ? { client: { orgId } } : undefined

  const [activeClients, totalClients, avgGriAggregate, clients, recentReports] = await Promise.all([
    db.client.count({ where: { ...(clientWhere ?? {}), status: 'active' } }),
    db.client.count({ where: clientWhere }),
    db.griReport.aggregate({ where: reportsWhere, _avg: { overallScore: true } }),
    db.client.findMany({
      where: clientWhere,
      include: {
        pulseMetrics: true,
        griReports: {
          orderBy: { calculatedAt: 'desc' },
          take: 2,
        },
      },
    }),
    db.griReport.findMany({
      where: reportsWhere,
      orderBy: { calculatedAt: 'desc' },
      take: 30,
      select: { overallScore: true },
    }),
  ])

  const portfolioGmv = clients.reduce((sum: number, client: AnalyticsClientRow) => sum + (client.pulseMetrics?.avgCheck ?? 0), 0)
  const churnBase = totalClients === 0
    ? 0
    : ((clients.filter((client: AnalyticsClientRow) => client.status === 'at_risk' || client.status === 'inactive').length / totalClients) * 100)

  const trend = recentReports
    .slice()
    .reverse()
    .map((report: { overallScore: number }) => Math.max(0, Math.min(100, Math.round(report.overallScore))))

  const industryMap = new Map<string, number>()
  for (const client of clients) {
    const current = industryMap.get(client.industry) ?? 0
    industryMap.set(client.industry, current + (client.pulseMetrics?.avgCheck ?? 0))
  }

  const industryBreakdown = [...industryMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  const clientPerformance = clients
    .map((client: AnalyticsClientRow) => {
      const latest = client.griReports[0]?.overallScore ?? 0
      const previous = client.griReports[1]?.overallScore ?? latest
      const growth = previous === 0 ? 0 : ((latest - previous) / previous) * 100

      return {
        id: client.id,
        name: client.name,
        industry: client.industry,
        gri: Math.round(latest * 10),
        gmv: client.pulseMetrics?.avgCheck ?? 0,
        growth: roundTo(growth),
        status: toStatus(latest),
      }
    })
    .sort((a: { gri: number }, b: { gri: number }) => b.gri - a.gri)
    .slice(0, 10)

  return {
    kpis: {
      avgGriScore: Math.round((avgGriAggregate._avg.overallScore ?? 0) * 10),
      portfolioGmv,
      activeClients,
      churnRate: roundTo(churnBase),
    },
    trend,
    industryBreakdown,
    clientPerformance,
  }
}
