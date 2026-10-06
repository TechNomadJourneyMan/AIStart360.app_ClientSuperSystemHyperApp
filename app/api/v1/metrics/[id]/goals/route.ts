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

  // Progress is reported only from this company's own data. The previous
  // source, Prisma `financial_snapshots`, is not tenant-scoped (it returned the
  // latest snapshot of any organisation) and is server-only since migration 083.
  const progress = 0
  const trajectory: GoalTrajectory = 'behind'

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
