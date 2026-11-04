import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getSessionUserId } from '@/lib/api-auth'
import type { MetricSummary } from '@/types/metrics'

/**
 * GET /api/v1/metrics — legacy KPI summary for the Point A hero cards.
 *
 * Source of truth is the org-scoped `financial_snapshots` table (Prisma).
 * IMPORTANT: this used to return a hardcoded MOCK_METRICS payload (₸84.2М …)
 * whenever the table was empty — which is the normal case for Supabase
 * tenants — and queried snapshots with NO tenant filter (cross-tenant leak).
 * Both are removed. Real values come from the resolver (/api/v1/metrics/catalog);
 * here we return an honest empty summary when there is no org-scoped snapshot,
 * and the hero degrades to its "Нет данных" tiles.
 */
export async function GET() {
  const [supaUserId, session] = await Promise.all([
    getSessionUserId(),
    auth().catch(() => null),
  ])
  const orgId = (session?.user as { orgId?: string } | undefined)?.orgId

  // Must be authenticated through either auth source.
  if (!supaUserId && !orgId) {
    return NextResponse.json({ source: 'unauthorized', data: [] as MetricSummary[] }, { status: 401 })
  }

  // No org → no legacy snapshot to read. Honest empty (NOT mock, NOT cross-tenant).
  if (!orgId) {
    return NextResponse.json({ source: 'empty', data: [] as MetricSummary[] })
  }

  try {
    const snapshots = await prisma.financialSnapshot.findMany({
      where: { orgId },
      orderBy: { recordedAt: 'desc' },
      take: 2,
    })

    if (snapshots.length === 0) {
      return NextResponse.json({ source: 'empty', data: [] as MetricSummary[] })
    }

    const snap = snapshots[0]
    const prev = snapshots[1] ?? null

    const revenue = snap.revenueKzt
    const margin = snap.marginPct
    const clients = snap.clientsCount
    const revenueChange = snap.revenueChange
    const marginChange = snap.marginChange
    const clientsChange = snap.clientsChange

    const prevRevenue = prev?.revenueKzt ?? 0
    const prevClients = prev?.clientsCount ?? 0

    const avgCheck = clients > 0 ? revenue / clients : 0
    const prevAvgCheck = prev && prevClients > 0 ? prevRevenue / prevClients : null
    const avgCheckChange =
      prevAvgCheck && prevAvgCheck > 0 ? ((avgCheck - prevAvgCheck) / prevAvgCheck) * 100 : 0

    const metrics: MetricSummary[] = [
      {
        id: 'revenue',
        label: 'Доход',
        displayValue: `₸${revenue.toFixed(1)}М`,
        rawValue: revenue,
        unit: '₸М',
        unitPosition: 'before',
        trend: revenueChange,
        trendAbs: revenue * (revenueChange / 100),
        trendDirection: revenueChange > 0 ? 'up' : revenueChange < 0 ? 'down' : 'flat',
        trendLabel: 'vs прошлый квартал',
        icon: 'payments',
        color: '#6effc0',
        goalCategory: 'revenue',
        isDefault: true,
        isRemovable: false,
      },
      {
        id: 'margin',
        label: 'Маржа',
        displayValue: `${margin.toFixed(1)}%`,
        rawValue: margin,
        unit: '%',
        unitPosition: 'after',
        trend: marginChange,
        trendAbs: marginChange,
        trendDirection: marginChange > 0 ? 'up' : marginChange < 0 ? 'down' : 'flat',
        trendLabel: 'чистая маржинальность',
        icon: 'percent',
        color: '#bcc7de',
        goalCategory: 'margin',
        isDefault: true,
        isRemovable: false,
      },
      {
        id: 'clients',
        label: 'Клиенты',
        displayValue: String(clients),
        rawValue: clients,
        unit: '',
        unitPosition: 'after',
        trend: clientsChange,
        trendAbs: clientsChange,
        trendDirection: clientsChange > 0 ? 'up' : clientsChange < 0 ? 'down' : 'flat',
        trendLabel: 'активных клиентов',
        icon: 'groups',
        color: '#ffbd60',
        goalCategory: 'clients',
        isDefault: true,
        isRemovable: false,
      },
      {
        id: 'avg_check',
        label: 'Средний чек',
        displayValue: `₸${avgCheck.toFixed(2)}М`,
        rawValue: avgCheck,
        unit: '₸М',
        unitPosition: 'before',
        trend: avgCheckChange,
        trendAbs: avgCheck - (prevAvgCheck ?? avgCheck),
        trendDirection: avgCheckChange > 0.1 ? 'up' : avgCheckChange < -0.1 ? 'down' : 'flat',
        trendLabel: 'на клиента',
        icon: 'receipt_long',
        color: '#c9a6ff',
        goalCategory: 'avg_check',
        isDefault: true,
        isRemovable: false,
      },
    ]

    return NextResponse.json({ source: 'db', data: metrics })
  } catch (err) {
    console.error('[api/v1/metrics]', err)
    // Honest empty on error — never fabricated data.
    return NextResponse.json({ source: 'error', data: [] as MetricSummary[] }, { status: 200 })
  }
}
