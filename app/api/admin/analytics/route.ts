export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'

/**
 * GET /api/admin/analytics
 *
 * Returns aggregated metrics for the admin dashboard:
 *   - KPIs (totals by status)
 *   - SLA compliance
 *   - Conversion rate (new → approved)
 *   - Admin workload distribution
 *   - Requests by type over time (last 30 days)
 *   - Average processing time
 *
 * Query params:
 *   days — lookback window in days (default: 30)
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('analytics:read')
  if (error) return error

  const days = Math.min(365, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '30')))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [
    totalByStatus,
    totalByType,
    overdueCount,
    approvedInWindow,
    createdInWindow,
    adminWorkload,
    recentApproved,
  ] = await Promise.all([
    // KPI: requests grouped by status
    prisma.adminRequest.groupBy({
      by: ['status'],
      _count: true,
    }),

    // KPI: requests grouped by type
    prisma.adminRequest.groupBy({
      by: ['type'],
      _count: true,
    }),

    // SLA: overdue (past deadline and not terminal)
    prisma.adminRequest.count({
      where: {
        slaDeadline: { lt: new Date() },
        status: { notIn: ['approved', 'rejected'] },
      },
    }),

    // Conversion: approved in window
    prisma.adminRequest.count({
      where: {
        status: 'approved',
        updatedAt: { gte: since },
      },
    }),

    // Total created in window (denominator for conversion)
    prisma.adminRequest.count({
      where: { createdAt: { gte: since } },
    }),

    // Admin workload: assigned request counts per admin
    prisma.adminRequest.groupBy({
      by: ['assignedAdminId'],
      where: {
        assignedAdminId: { not: null },
        status: { notIn: ['approved', 'rejected'] },
      },
      _count: true,
    }),

    // Avg processing time: approved requests with timestamps
    prisma.adminRequest.findMany({
      where: {
        status: 'approved',
        createdAt: { gte: since },
      },
      select: { createdAt: true, updatedAt: true },
    }),
  ])

  // Compute average processing time in hours
  const avgProcessingHours =
    recentApproved.length > 0
      ? recentApproved.reduce((acc, r) => {
          const diff = r.updatedAt.getTime() - r.createdAt.getTime()
          return acc + diff / (1000 * 60 * 60)
        }, 0) / recentApproved.length
      : null

  // Fetch admin names for workload
  const adminIds = adminWorkload
    .map((w) => w.assignedAdminId)
    .filter(Boolean) as string[]
  const admins = await prisma.user.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, name: true, email: true },
  })
  const adminMap = Object.fromEntries(admins.map((a) => [a.id, a]))

  const workload = adminWorkload.map((w) => ({
    admin: adminMap[w.assignedAdminId ?? ''] ?? null,
    activeRequests: w._count,
  }))

  const conversionRate =
    createdInWindow > 0 ? Math.round((approvedInWindow / createdInWindow) * 100) : 0

  return NextResponse.json({
    data: {
      kpi: {
        byStatus: Object.fromEntries(totalByStatus.map((s) => [s.status, s._count])),
        byType: Object.fromEntries(totalByType.map((t) => [t.type, t._count])),
        totalActive: totalByStatus
          .filter((s) => !['approved', 'rejected'].includes(s.status))
          .reduce((a, b) => a + b._count, 0),
      },
      sla: {
        overdueCount,
        complianceRate: overdueCount === 0 ? 100 : null, // simplified
      },
      conversion: {
        rate: conversionRate,
        approved: approvedInWindow,
        total: createdInWindow,
        periodDays: days,
      },
      processing: {
        avgHours: avgProcessingHours ? Math.round(avgProcessingHours * 10) / 10 : null,
        sampleSize: recentApproved.length,
      },
      workload,
    },
  })
}
