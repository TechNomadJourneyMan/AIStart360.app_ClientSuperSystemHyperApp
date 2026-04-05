export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * GET /api/giga-admin/clients
 * Returns all platform clients with latest GRI report and pulse metrics.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const clients = await prisma.client.findMany({
      include: {
        manager: { select: { id: true, name: true, email: true } },
        griReports: {
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        },
        pulseMetrics: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const mapped = clients.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      stage: c.stage,
      status: c.status,
      website: c.website,
      createdAt: c.createdAt.toISOString(),
      manager: c.manager
        ? { id: c.manager.id, name: c.manager.name, email: c.manager.email }
        : null,
      latestGri: c.griReports[0]
        ? {
            score: c.griReports[0].score,
            productScore: c.griReports[0].productScore,
            trustScore: c.griReports[0].trustScore,
            businessModelScore: c.griReports[0].businessModelScore,
            cashScore: c.griReports[0].cashScore,
            operationsScore: c.griReports[0].operationsScore,
            teamScore: c.griReports[0].teamScore,
            founderScore: c.griReports[0].founderScore,
            calculatedAt: c.griReports[0].calculatedAt.toISOString(),
          }
        : null,
      pulseMetrics: c.pulseMetrics
        ? {
            riskScore: c.pulseMetrics.riskScore,
            churnLevel: c.pulseMetrics.churnLevel,
            churnProb: c.pulseMetrics.churnProb,
            avgCheck: c.pulseMetrics.avgCheck,
            lastOrder: c.pulseMetrics.lastOrder?.toISOString() ?? null,
            daysSince: c.pulseMetrics.daysSince,
          }
        : null,
    }))

    return NextResponse.json({ clients: mapped })
  } catch (error) {
    console.error('[giga-admin/clients] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
