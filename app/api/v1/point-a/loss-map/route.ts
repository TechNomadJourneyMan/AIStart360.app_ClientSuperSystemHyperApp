export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  clamp01,
  loadV3Context,
  num,
  resolveCompanyId,
} from '@/lib/point-a/v3/route-helpers'
import {
  computeLossMap,
  emptyLossMap,
  type LossMapInputs,
} from '@/lib/point-a/v3/loss-map'
import type { ApiResult } from '@/types/onboarding'
import type { LossMap } from '@/types/point-a-v3'

const CACHE_HEADER = 'private, max-age=300, stale-while-revalidate=600'

function ok(data: LossMap): NextResponse {
  const body: ApiResult<LossMap> = { ok: true, data }
  return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_HEADER } })
}

/**
 * GET /api/v1/point-a/loss-map
 *
 * Loss-map signals come from the survey + parsed funnel docs:
 *   AOV       → s2_avg_check
 *   leads/mes → s5n_leads_per_month or s3_leads_per_month
 *   no-show%  → s5n_no_show_rate
 *   missed%   → s5n_missed_rate or 1 - s5n_funnel_lead_to_call
 *   target_AOV → s2_avg_check_target
 *   NPS       → s5n_will_return_nps
 *   LTV       → s2_ltv
 *   freqDays  → s2_repeat_freq_days
 *
 * Anything missing degrades gracefully (the matching bucket = 0).
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    const body: ApiResult<LossMap> = { ok: false, error: 'Unauthorized' }
    return NextResponse.json(body, { status: 401 })
  }

  const companyId = await resolveCompanyId(supabase, user.id)
  if (!companyId) return ok(emptyLossMap())

  try {
    const { resolver, clientBase } = await loadV3Context(
      supabase,
      user.id,
      companyId,
    )
    const s = resolver.surveyAnswers

    // Extract spec signals; null when missing.
    const aov   = num(s['s2_avg_check']) ?? 0
    const leads = num(s['s5n_leads_per_month']) ?? num(s['s3_leads_per_month']) ?? 0
    const noShow = clamp01(num(s['s5n_no_show_rate']))
    let missed = clamp01(num(s['s5n_missed_rate']))
    if (missed === 0) {
      const leadToCall = clamp01(num(s['s5n_funnel_lead_to_call']))
      if (leadToCall > 0 && leadToCall < 1) missed = 1 - leadToCall
    }
    const targetAov = num(s['s2_avg_check_target'])
    const nps  = num(s['s5n_will_return_nps'])
    const ltv  = num(s['s2_ltv']) ?? 0
    const freq = num(s['s2_repeat_freq_days']) ?? 90

    const inputs: LossMapInputs = {
      avg_check_kzt: aov,
      leads_per_month: leads,
      no_show_rate: noShow,
      missed_rate: missed,
      target_aov_kzt: targetAov,
      nps,
      ltv_kzt: ltv,
      freq_days: freq,
      now: resolver.now,
    }

    return ok(computeLossMap(clientBase.rows, inputs))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(`[point-a/loss-map] failed: ${message}`)
    return ok(emptyLossMap())
  }
}
