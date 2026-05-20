export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  loadV3Context,
  num,
  resolveCompanyId,
} from '@/lib/point-a/v3/route-helpers'
import {
  computeRetentionCurve,
  emptyRetentionCurve,
} from '@/lib/point-a/v3/retention-curve'
import type { ApiResult } from '@/types/onboarding'
import type { RetentionCurve } from '@/types/point-a-v3'

const CACHE_HEADER = 'private, max-age=300, stale-while-revalidate=600'

function ok(data: RetentionCurve): NextResponse {
  const body: ApiResult<RetentionCurve> = { ok: true, data }
  return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_HEADER } })
}

/**
 * GET /api/v1/point-a/retention-curve
 *
 * Returns 5-horizon retention curve. Yearly plan (clients/year)
 * is read from the survey `s2_new_clients_2026` answer when
 * available; otherwise plan_slice is 0.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    const body: ApiResult<RetentionCurve> = { ok: false, error: 'Unauthorized' }
    return NextResponse.json(body, { status: 401 })
  }

  const companyId = await resolveCompanyId(supabase, user.id)
  if (!companyId) return ok(emptyRetentionCurve())

  try {
    const { resolver, clientBase } = await loadV3Context(
      supabase,
      user.id,
      companyId,
    )

    const yearlyPlan =
      num(resolver.surveyAnswers['s2_new_clients_2026']) ??
      num(resolver.surveyAnswers['s2_new_clients_2025']) ??
      0

    if (!clientBase.has_client_base) {
      // Honour `plan_slice` even without a base.
      return ok(
        computeRetentionCurve([], { yearlyPlanClients: yearlyPlan, now: resolver.now }),
      )
    }

    return ok(
      computeRetentionCurve(clientBase.rows, {
        yearlyPlanClients: yearlyPlan,
        now: resolver.now,
      }),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(`[point-a/retention-curve] failed: ${message}`)
    return ok(emptyRetentionCurve())
  }
}
