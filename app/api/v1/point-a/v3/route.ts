export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  loadV3Context,
  resolveCompanyId,
} from '@/lib/point-a/v3/route-helpers'
import { aggregatePointAV3, V3_METRIC_IDS, v3MetricsFromCompanyMetrics } from '@/lib/point-a/v3/aggregator-v3'
import { loadCompanyMetrics } from '@/lib/metrics/company-metrics'
import type { ApiResult } from '@/types/onboarding'
import type { PointAV3 } from '@/types/point-a-v3'

const CACHE_HEADER = 'private, max-age=300, stale-while-revalidate=600'

function ok(data: PointAV3): NextResponse {
  const body: ApiResult<PointAV3> = { ok: true, data }
  return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_HEADER } })
}

/**
 * GET /api/v1/point-a/v3
 *
 * Returns the 6-block PointAV3 payload (Sales / Client / Retention /
 * Finance / Funnel / AI-comms). Delegates to the pure aggregator
 * in lib/point-a/v3/aggregator-v3.ts so this handler stays thin.
 *
 * Metric values (revenue, average check, new clients, LTV, CAC, gross
 * margin) come from the company's current metrics — public.metrics via
 * loadCompanyMetrics, the single source the Metrics page, dashboard heroes,
 * Точка А and Точка Б read — so the V3 blocks never disagree with them.
 * Survey answers only fill V3-specific inputs and older-form fallbacks.
 *
 * Fails soft: when there is no company / no documents yet, returns
 * an empty payload (all metrics `no_data`) rather than a 4xx error.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    const body: ApiResult<PointAV3> = { ok: false, error: 'Unauthorized' }
    return NextResponse.json(body, { status: 401 })
  }

  const companyId = await resolveCompanyId(supabase, user.id)
  if (!companyId) {
    return ok(aggregatePointAV3({}))
  }

  try {
    const [{ resolver }, metrics] = await Promise.all([
      loadV3Context(supabase, user.id, companyId),
      loadCompanyMetrics(supabase, companyId, V3_METRIC_IDS),
    ])
    const payload = aggregatePointAV3({
      surveyAnswers: resolver.surveyAnswers,
      metrics: v3MetricsFromCompanyMetrics(metrics),
      now: resolver.now,
    })
    return ok(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(`[point-a/v3] failed: ${message}`)
    return ok(aggregatePointAV3({}))
  }
}
