import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await auth()
    const orgId = (session?.user as any)?.orgId

    // Try to get real financial snapshot for the org
    let snapshot = null
    if (orgId) {
      snapshot = await prisma.financialSnapshot.findFirst({
        where: { orgId },
        orderBy: { recordedAt: 'desc' },
      })
    }

    // If no org-specific snapshot, get the latest one across all orgs
    if (!snapshot) {
      snapshot = await prisma.financialSnapshot.findFirst({
        orderBy: { recordedAt: 'desc' },
      })
    }

    if (!snapshot) {
      return NextResponse.json({ source: 'mock', data: null })
    }

    return NextResponse.json({
      source: 'db',
      period: snapshot.period,
      kpi: [
        {
          label: 'Доход',
          value: `₸${snapshot.revenueKzt.toFixed(1)}М`,
          trend: `${snapshot.revenueChange > 0 ? '+' : ''}${snapshot.revenueChange.toFixed(1)}%`,
          trendUp: snapshot.revenueChange >= 0,
          sublabel: 'vs прошлый квартал',
          icon: 'payments',
          href: '/analytics',
        },
        {
          label: 'Маржа',
          value: `${snapshot.marginPct.toFixed(1)}%`,
          trend: `${snapshot.marginChange > 0 ? '+' : ''}${snapshot.marginChange.toFixed(1)} пп`,
          trendUp: snapshot.marginChange >= 0,
          sublabel: 'чистая маржинальность',
          icon: 'percent',
          href: '/metrics',
        },
        {
          label: 'Клиенты',
          value: String(snapshot.clientsCount),
          trend: `${snapshot.clientsChange > 0 ? '+' : ''}${snapshot.clientsChange}`,
          trendUp: snapshot.clientsChange >= 0,
          sublabel: 'активных клиентов',
          icon: 'groups',
          href: '/clients',
        },
        {
          label: 'Расходы',
          value: `₸${snapshot.expensesKzt.toFixed(1)}М`,
          trend: `${snapshot.expensesChange > 0 ? '+' : ''}${snapshot.expensesChange.toFixed(1)}%`,
          trendUp: snapshot.expensesChange < 0,
          sublabel: 'операционные расходы',
          icon: 'trending_down',
          href: '/metrics',
        },
      ],
    })
  } catch (err) {
    console.error('[api/dashboard/kpi]', err)
    return NextResponse.json({ source: 'error', data: null }, { status: 500 })
  }
}
