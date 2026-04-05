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
    const supabase = createServerClient()

    // Get the two most recent snapshots for trend calculation
    const { data: snapshots, error } = await supabase
      .from('financial_snapshots')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(2)

    if (error || !snapshots || snapshots.length === 0) {
      return NextResponse.json({ source: 'mock', data: MOCK_METRICS })
    }

    const snap = snapshots[0]
    const prev = snapshots[1] ?? null

    const avgCheck =
      snap.clients_count > 0 ? snap.revenue_kzt / snap.clients_count : 1.75

    const prevAvgCheck =
      prev && prev.clients_count > 0
        ? prev.revenue_kzt / prev.clients_count
        : null

    const avgCheckChange =
      prevAvgCheck && prevAvgCheck > 0
        ? ((avgCheck - prevAvgCheck) / prevAvgCheck) * 100
        : 0

    const metrics: MetricSummary[] = [
      {
        id: 'revenue',
        label: 'Доход',
        displayValue: `₸${Number(snap.revenue_kzt).toFixed(1)}М`,
        rawValue: Number(snap.revenue_kzt),
        unit: '₸М',
        unitPosition: 'before',
        trend: Number(snap.revenue_change),
        trendAbs: Number(snap.revenue_kzt) * (Number(snap.revenue_change) / 100),
        trendDirection:
          snap.revenue_change > 0 ? 'up' : snap.revenue_change < 0 ? 'down' : 'flat',
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
        displayValue: `${Number(snap.margin_pct).toFixed(1)}%`,
        rawValue: Number(snap.margin_pct),
        unit: '%',
        unitPosition: 'after',
        trend: Number(snap.margin_change),
        trendAbs: Number(snap.margin_change),
        trendDirection:
          snap.margin_change > 0 ? 'up' : snap.margin_change < 0 ? 'down' : 'flat',
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
        displayValue: String(snap.clients_count),
        rawValue: Number(snap.clients_count),
        unit: '',
        unitPosition: 'after',
        trend: Number(snap.clients_change),
        trendAbs: Number(snap.clients_change),
        trendDirection:
          snap.clients_change > 0 ? 'up' : snap.clients_change < 0 ? 'down' : 'flat',
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
