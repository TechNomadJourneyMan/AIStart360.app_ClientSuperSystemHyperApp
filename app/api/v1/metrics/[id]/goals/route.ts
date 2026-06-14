// ============================================================
// GET /api/v1/metrics/[id]/goals — real goal for a metric.
//
// No mock data. The only goal we can source today is the owner-declared
// revenue target on public.companies (migration 018). For every other metric
// we return null, so the UI shows "цель не задана" rather than a fabricated
// goal. See docs/metrics-data-lineage.md (D4).
// ============================================================

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MetricGoal, GoalTrajectory } from '@/types/metrics'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  // Only the revenue metric has a real, owner-declared target today.
  if (id !== 'revenue') {
    return NextResponse.json({ data: null as MetricGoal | null })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ data: null as MetricGoal | null }, { status: 401 })
  }

  const { data: company } = await supabase
    .from('companies')
    .select('id, target_revenue_12m_kzt')
    .eq('user_id', user.id)
    .maybeSingle()

  const target = company?.target_revenue_12m_kzt
  if (target == null || Number(target) <= 0) {
    // No real target set → no goal. UI shows empty/“цель не задана”.
    return NextResponse.json({ data: null as MetricGoal | null })
  }

  const targetKzt = Number(target)
  const targetMln = targetKzt / 1_000_000

  // Real progress against the latest financial snapshot, if one exists.
  let progress = 0
  let trajectory: GoalTrajectory = 'behind'
  const { data: snaps } = await supabase
    .from('financial_snapshots')
    .select('*')
    .order('recordedAt', { ascending: false })
    .limit(1)
  const snap = snaps?.[0] as Record<string, any> | undefined
  if (snap) {
    const revenueMln = Number(snap.revenueKzt ?? snap.revenue_kzt ?? 0)
    if (targetMln > 0) {
      progress = Math.max(0, Math.min(100, Math.round((revenueMln / targetMln) * 100)))
      trajectory = progress >= 80 ? 'on_track' : progress >= 50 ? 'at_risk' : 'behind'
    }
  }

  const goal: MetricGoal = {
    goalId: `company-${company!.id}-revenue-12m`,
    metricId: 'revenue',
    targetValue: Number(targetMln.toFixed(2)),
    targetUnit: '₸М',
    deadline: null,
    progress,
    trajectory,
  }

  return NextResponse.json({ data: goal })
}
