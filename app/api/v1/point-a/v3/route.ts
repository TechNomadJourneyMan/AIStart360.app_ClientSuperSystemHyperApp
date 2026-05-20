export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  loadV3Context,
  resolveCompanyId,
} from '@/lib/point-a/v3/route-helpers'
import { aggregatePointAV3 } from '@/lib/point-a/v3/aggregator-v3'
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
    const { resolver } = await loadV3Context(supabase, user.id, companyId)
    const payload = aggregatePointAV3({
      surveyAnswers: resolver.surveyAnswers,
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
