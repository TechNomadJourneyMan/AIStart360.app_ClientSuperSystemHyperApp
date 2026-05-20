export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  loadV3Context,
  resolveCompanyId,
} from '@/lib/point-a/v3/route-helpers'
import { computeRFM, emptyRFMResult } from '@/lib/point-a/v3/rfm'
import type { ApiResult } from '@/types/onboarding'
import type { RFMResult } from '@/types/point-a-v3'

const CACHE_HEADER = 'private, max-age=300, stale-while-revalidate=600'

function ok(data: RFMResult): NextResponse {
  const body: ApiResult<RFMResult> = { ok: true, data }
  return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_HEADER } })
}

/**
 * GET /api/v1/point-a/segments
 *
 * Returns the 7-segment RFM result for the caller's company.
 * Fails soft: when there is no client-base document yet, returns
 * an empty RFMResult with `has_client_base: false` rather than
 * a 4xx error.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    const body: ApiResult<RFMResult> = { ok: false, error: 'Unauthorized' }
    return NextResponse.json(body, { status: 401 })
  }

  const companyId = await resolveCompanyId(supabase, user.id)
  if (!companyId) {
    // Fail-soft per spec: return empty curve, not an error.
    return ok(emptyRFMResult())
  }

  try {
    const { clientBase } = await loadV3Context(supabase, user.id, companyId)
    if (!clientBase.has_client_base) {
      return ok(emptyRFMResult())
    }
    return ok(computeRFM(clientBase.rows))
  } catch (err) {
    // Fail-soft: log + return empty so the dashboard never blanks.
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(`[point-a/segments] failed: ${message}`)
    return ok(emptyRFMResult())
  }
}
