import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { MetricSummary } from '@/types/metrics'

// Mock data for orgs without DB snapshots
const MOCK_METRICS: MetricSummary[] = [
  {
    id: 'revenue',
    label: 'Доход',
    displayValue: '₸84.2М',
    rawValue: 84.2,
    unit: '₸М',
    unitPosition: 'before',
    trend: 12.4,
    trendAbs: 9.3,
    trendDirection: 'up',
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
    displayValue: '34.2%',
    rawValue: 34.2,
    unit: '%',
    unitPosition: 'after',
    trend: 2.1,
    trendAbs: 2.1,
    trendDirection: 'up',
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
    displayValue: '48',
    rawValue: 48,
    unit: '',
    unitPosition: 'after',
    trend: 14.3,
    trendAbs: 6,
    trendDirection: 'up',
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
    displayValue: '₸1.75М',
    rawValue: 1.75,
    unit: '₸М',
    unitPosition: 'before',
    trend: 0,
    trendAbs: 0,
    trendDirection: 'flat',
    trendLabel: 'на клиента',
    icon: 'receipt_long',
    color: '#c9a6ff',
    goalCategory: 'avg_check',
    isDefault: true,
    isRemovable: false,
  },
]

export async function GET() {
  try {
    const session = await auth()
    const orgId = (session?.user as any)?.orgId

    let snapshot = null
    if (orgId) {
      snapshot = await prisma.financialSnapshot.findFirst({
        where: { orgId },
        orderBy: { recordedAt: 'desc' },
      })
    }

    if (!snapshot) {
      return NextResponse.json({ source: 'mock', data: MOCK_METRICS })
    }

    const avgCheck = snapshot.clientsCount > 0
      ? snapshot.revenueKzt / snapshot.clientsCount
      : 1.75

    const metrics: MetricSummary[] = [
      {
        id: 'revenue',
        label: 'Доход',
        displayValue: `₸${snapshot.revenueKzt.toFixed(1)}М`,
        rawValue: snapshot.revenueKzt,
        unit: '₸М',
        unitPosition: 'before',
        trend: snapshot.revenueChange,
        trendAbs: snapshot.revenueKzt * (snapshot.revenueChange / 100),
        trendDirection: snapshot.revenueChange > 0 ? 'up' : snapshot.revenueChange < 0 ? 'down' : 'flat',
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
        displayValue: `${snapshot.marginPct.toFixed(1)}%`,
        rawValue: snapshot.marginPct,
        unit: '%',
        unitPosition: 'after',
        trend: snapshot.marginChange,
        trendAbs: snapshot.marginChange,
        trendDirection: snapshot.marginChange > 0 ? 'up' : snapshot.marginChange < 0 ? 'down' : 'flat',
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
        displayValue: String(snapshot.clientsCount),
        rawValue: snapshot.clientsCount,
        unit: '',
        unitPosition: 'after',
        trend: snapshot.clientsChange,
        trendAbs: snapshot.clientsChange,
        trendDirection: snapshot.clientsChange > 0 ? 'up' : snapshot.clientsChange < 0 ? 'down' : 'flat',
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
        trend: 0,
        trendAbs: 0,
        trendDirection: 'flat',
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
    return NextResponse.json({ source: 'error', data: [] }, { status: 500 })
  }
}
