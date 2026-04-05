import { prisma } from '@/lib/db'
import type { Prisma, PrismaClient } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

export async function getDashboardKpiData(db: DbClient = prisma, orgId?: string) {
  const clientWhere = orgId
    ? { status: 'active' as const, orgId }
    : { status: 'active' as const }

  const [clientCount, orgCount, avgGriData] = await Promise.all([
    db.client.count({ where: clientWhere }),
    db.organization.count({ where: orgId ? { id: orgId } : undefined }),
    db.griReport.aggregate({
      where: orgId ? { client: { orgId } } : undefined,
      _avg: { score: true },
    }),
  ])

  return {
    clientCount,
    orgCount,
    avgGri: Number(avgGriData._avg.score ?? 0),
  }
}
