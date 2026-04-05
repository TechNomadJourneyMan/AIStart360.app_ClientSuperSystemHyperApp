import { formatDistanceToNow } from 'date-fns'
import { prisma } from '@/lib/db'
import type { ActivityItem, Alert } from '@/types'

type DbClient = {
  client: {
    findMany: typeof prisma.client.findMany
  }
  griReport: {
    findMany: typeof prisma.griReport.findMany
  }
}

function toRelativeTime(date: Date) {
  return formatDistanceToNow(date, { addSuffix: true })
}

export async function getDashboardAlerts(db: DbClient = prisma): Promise<Alert[]> {
  const atRiskClients = await db.client.findMany({
    where: { status: 'at_risk' },
    orderBy: { updatedAt: 'desc' },
    take: 4,
    select: {
      id: true,
      name: true,
      industry: true,
      updatedAt: true,
    },
  })

  return atRiskClients.map((client: (typeof atRiskClients)[number]) => ({
    id: client.id,
    severity: 'critical',
    title: client.name,
    description: `Клиент в зоне риска (${client.industry})`,
    time: toRelativeTime(client.updatedAt),
    action: {
      label: 'Открыть клиента',
      href: `/clients/${client.id}`,
    },
  }))
}

export async function getDashboardActivity(db: DbClient = prisma): Promise<ActivityItem[]> {
  const reports = await db.griReport.findMany({
    orderBy: { calculatedAt: 'desc' },
    take: 8,
    include: {
      client: {
        select: {
          id: true,
          name: true,
          industry: true,
          status: true,
        },
      },
    },
  })

  return reports.map((report: (typeof reports)[number]) => ({
    id: report.id,
    clientName: report.client.name,
    industry: report.client.industry,
    event: 'Обновлён GRI-отчёт',
    gri: Math.round(report.overallScore),
    status: report.client.status,
    time: toRelativeTime(report.calculatedAt),
  }))
}
