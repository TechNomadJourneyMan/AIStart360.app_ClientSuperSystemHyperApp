// ============================================================
// GET /api/v1/metrics/[id]/goals — real goal for a metric.
//
// No mock data. Goals come from the company's own rows only:
//   • public.metric_targets (migration 085) for any registry metric;
//   • the owner-declared 12-month revenue target (companies.
//     target_revenue_12m_kzt, survey step 1) for the revenue metric
//     (`revenue` alias or the registry ids biz.finansy.vyruchka_god /
//     kpi.obschaya_vyruchka_god).
// Progress = the company's latest public.metrics value vs the target
// (tenant resolved by lib/tenancy, read through the caller's session → RLS).
// Without a target → { data: null } («цель не задана»). Without a value →
// trajectory 'no_data', progress 0 and actualValue null (the UI says «нет
// факта», never «отстаём»). A failed read answers 500 — it is not «no goal» /
// «no value».
// ============================================================

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith } from '@/lib/tenancy'
import { getMetricById } from '@/lib/metrics/registry'
import {
  REVENUE_METRIC_IDS,
  goalProgress,
  isMissingTable,
  statusForValue,
  targetForMetric,
  type MetricTargetRow,
} from '@/lib/metrics/catalog-helpers'
import type { MetricGoal, GoalTrajectory } from '@/types/metrics'
import type { MetricTarget } from '@/types/metric-catalog'

function trajectoryFor(value: number | null, target: MetricTarget): GoalTrajectory {
  switch (statusForValue(value, target)) {
    case 'on_track': return 'on_track'
    case 'at_risk': return 'at_risk'
    case 'no_data': return 'no_data'
    default: return 'behind'
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params
  const isRevenue = id === 'revenue' || REVENUE_METRIC_IDS.has(id)
  if (!isRevenue && !getMetricById(id)) {
    return NextResponse.json({ data: null as MetricGoal | null })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ data: null as MetricGoal | null }, { status: 401 })
  }

  const companyIdParam = req.nextUrl?.searchParams.get('companyId') ?? null
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: companyIdParam, access: 'read' })
  if (!tenant.ok) {
    return NextResponse.json({ data: null as MetricGoal | null }, { status: companyIdParam ? tenant.status : 200 })
  }
  const companyId = tenant.tenant.companyId
  const metricIds = isRevenue ? Array.from(REVENUE_METRIC_IDS) : [id]

  const [companyRes, targetsRes, valuesRes] = await Promise.all([
    supabase.from('companies').select('id, target_revenue_12m_kzt').eq('id', companyId).maybeSingle(),
    supabase.from('metric_targets').select('metric_key, target_value, direction, period_label, source').eq('company_id', companyId).in('metric_key', metricIds),
    supabase
      .from('metrics')
      .select('metric_key, metric_value, computed_at')
      .eq('company_id', companyId)
      .in('metric_key', metricIds)
      .not('metric_value', 'is', null)
      .order('computed_at', { ascending: false, nullsFirst: false })
      .limit(1),
  ])

  // metric_targets is optional until migration 085 is applied (missing table
  // → no targets); any other failed read is an error, not «no goal» / «no value».
  const readError = companyRes.error ?? (targetsRes.error && !isMissingTable(targetsRes.error) ? targetsRes.error : null) ?? valuesRes.error
  if (readError) {
    console.error('[api/v1/metrics/[id]/goals] read failed', readError.code ?? '', readError.message ?? '')
    return NextResponse.json({ data: null as MetricGoal | null, error: 'Не удалось загрузить цель метрики' }, { status: 500 })
  }
  const revenueTarget = companyRes.data?.target_revenue_12m_kzt == null ? null : Number(companyRes.data.target_revenue_12m_kzt)
  const targetRows = (targetsRes.error ? [] : (targetsRes.data ?? [])) as MetricTargetRow[]
  const target = metricIds
    .map((m) => targetForMetric(m, targetRows, revenueTarget))
    .find((t): t is MetricTarget => t !== null) ?? null
  if (!target) {
    // No real target set → no goal. UI shows «цель не задана».
    return NextResponse.json({ data: null as MetricGoal | null })
  }

  const rawValue = valuesRes.data?.[0]?.metric_value ?? null
  const actual = rawValue === null ? null : Number(rawValue)
  const value = actual !== null && Number.isFinite(actual) ? actual : null

  // Revenue keeps its historical unit (millions of ₸); other metrics use the metric's own unit.
  const scale = isRevenue ? 1_000_000 : 1
  const unit = isRevenue ? '₸М' : (getMetricById(id)?.unit ?? '')
  const goal: MetricGoal = {
    goalId: `company-${companyId}-${isRevenue ? 'revenue' : id}-${target.periodLabel}`,
    metricId: id,
    targetValue: Number((target.value / scale).toFixed(2)),
    targetUnit: unit,
    deadline: null,
    progress: goalProgress(value, target),
    trajectory: trajectoryFor(value, target),
    actualValue: value === null ? null : Number((value / scale).toFixed(2)),
  }

  return NextResponse.json({ data: goal })
}
