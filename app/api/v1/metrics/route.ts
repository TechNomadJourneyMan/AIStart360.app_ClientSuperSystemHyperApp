import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MetricSummary } from '@/types/metrics'
import {
  buildCanonicalMetricSummaries,
  CANONICAL_KPI_ALIASES,
  type CanonicalMetricRow,
} from '@/lib/metrics/canonical-summary'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const product = searchParams.get('product')
  const manager = searchParams.get('manager')

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ source: 'canonical-point-a', data: [] as MetricSummary[] }, { status: 401 })
    }

    // Canonical scalar facts do not contain product/manager dimensions. An
    // aggregate company value under an active dimension filter would be
    // misleading, so return an explicit empty result for that combination.
    if (product || manager) {
      return NextResponse.json({
        source: 'canonical-point-a',
        data: [] as MetricSummary[],
        limitation: 'dimension_not_available',
      })
    }

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (companyError) throw companyError
    if (!company?.id) {
      return NextResponse.json({ source: 'canonical-point-a', data: [] as MetricSummary[] })
    }

    const { data: rows, error: metricsError } = await supabase
      .from('metrics')
      .select(
        'metric_key,metric_value,metric_unit,period_year,period_quarter,period_month,computed_at,recorded_at',
      )
      .eq('company_id', company.id)
      .eq('scenario', 'fact')
      .eq('source', 'calculated')
      .in('metric_key', CANONICAL_KPI_ALIASES)
      .order('computed_at', { ascending: false, nullsFirst: false })
    if (metricsError) throw metricsError

    return NextResponse.json({
      source: 'canonical-point-a',
      data: buildCanonicalMetricSummaries((rows ?? []) as CanonicalMetricRow[]),
    })
  } catch (err) {
    console.error('[api/v1/metrics]', err)
    return NextResponse.json({ source: 'error', error: 'metrics_failed' }, { status: 500 })
  }
}
