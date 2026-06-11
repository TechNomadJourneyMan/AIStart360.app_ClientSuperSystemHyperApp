import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import type { MetricSummary } from '@/types/metrics'

// NOTE: No mock fallback. When there is no real financial snapshot we return an
// empty list so the UI shows an explicit empty state ("—" from the catalog),
// never fabricated numbers. See docs/metrics-data-lineage.md (D3).

export async function GET(req: Request) {
  // Accept (and echo) the standard Point A filter triplet so the cache key
  // varies per filter. Server-side filtering of the snapshot rows is a TODO
  // until financial_snapshots carries the product/manager dimensions.
  const { searchParams } = new URL(req.url)
  const _period = searchParams.get('period')
  const _product = searchParams.get('product')
  const _manager = searchParams.get('manager')
  void _period; void _product; void _manager
  try {
    const supabase = createServerClient()

    // Get the two most recent snapshots for trend calculation
    const { data: snapshots, error } = await supabase
      .from('financial_snapshots')
      .select('*')
      .order('recordedAt', { ascending: false })
      .limit(2)

    if (error || !snapshots || snapshots.length === 0) {
      return NextResponse.json({ source: 'empty', data: [] as MetricSummary[] })
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

    const avgCheck = clients > 0 ? revenue / clients : 0
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
    return NextResponse.json({ source: 'error', data: [] as MetricSummary[] }, { status: 200 })
  }
}
