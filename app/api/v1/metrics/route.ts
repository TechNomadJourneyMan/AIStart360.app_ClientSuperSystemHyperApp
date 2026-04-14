import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import type { MetricSummary } from '@/types/metrics'

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
    trend: 2.4,
    trendAbs: 2.4,
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
    label: 'Clients',
    displayValue: '48',
    rawValue: 48,
    unit: '',
    unitPosition: 'after',
    trend: 14.3,
    trendAbs: 6,
    trendDirection: 'up',
    trendLabel: 'active клиентов',
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
    const supabase = createServerClient()

    // Get the two most recent snapshots for trend calculation
    const { data: snapshots, error } = await supabase
      .from('financial_snapshots')
      .select('*')
      .order('recordedAt', { ascending: false })
      .limit(2)

    if (error || !snapshots || snapshots.length === 0) {
      return NextResponse.json({ source: 'mock', data: MOCK_METRICS })
    }

    const snap = snapshots[0] as Record<string, any>
    const prev = (snapshots[1] ?? null) as Record<string, any> | null

    // Support both camelCase (Prisma) and snake_case (Supabase native) column names
    const revenue = Number(snap.revenueKzt ?? snap.revenue_kzt ?? 0)
    const margin = Number(snap.marginPct ?? snap.margin_pct ?? 0)
    const clients = Number(snap.clientsCount ?? snap.clients_count ?? 0)
    const expenses = Number(snap.expensesKzt ?? snap.expenses_kzt ?? 0)
    const revenueChange = Number(snap.revenueChange ?? snap.revenue_change ?? 0)
    const marginChange = Number(snap.marginChange ?? snap.margin_change ?? 0)
    const clientsChange = Number(snap.clientsChange ?? snap.clients_change ?? 0)

    const prevRevenue = prev ? Number(prev.revenueKzt ?? prev.revenue_kzt ?? 0) : 0
    const prevClients = prev ? Number(prev.clientsCount ?? prev.clients_count ?? 0) : 0

    const avgCheck = clients > 0 ? revenue / clients : 1.75
    const prevAvgCheck = prev && prevClients > 0 ? prevRevenue / prevClients : null

    const avgCheckChange =
      prevAvgCheck && prevAvgCheck > 0
        ? ((avgCheck - prevAvgCheck) / prevAvgCheck) * 100
        : 0

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
        label: 'Clients',
        displayValue: String(clients),
        rawValue: clients,
        unit: '',
        unitPosition: 'after',
        trend: clientsChange,
        trendAbs: clientsChange,
        trendDirection: clientsChange > 0 ? 'up' : clientsChange < 0 ? 'down' : 'flat',
        trendLabel: 'active клиентов',
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
        trendDirection:
          avgCheckChange > 0.1 ? 'up' : avgCheckChange < -0.1 ? 'down' : 'flat',
        trendLabel: 'на клиента',
        icon: 'receipt_long',
        color: '#c9a6ff',
        goalCategory: 'avg_check',
        isDefault: true,
        isRemovable: false,
      },
    ]

    return NextResponse.json({ source: 'supabase', data: metrics })
  } catch (err) {
    console.error('[api/v1/metrics]', err)
    return NextResponse.json({ source: 'error', data: MOCK_METRICS }, { status: 200 })
  }
}
