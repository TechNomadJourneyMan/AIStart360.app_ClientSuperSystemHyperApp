export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { getSessionUser, getSessionRole, isStaffRole } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { internalFetchHeaders } from '@/lib/internal-auth'

/**
 * POST /api/v1/diagnostics/retry-ai
 * Retries AI analysis for a diagnostic that previously failed.
 * Sets ai_status to 'processing' and fires the ai-analyze endpoint. The last
 * stored analysis (and keys other writers keep in ai_analysis) stays until the
 * new one replaces it — a failed retry no longer wipes it. The status is
 * written with the service role after the owner / staff check: `diagnostics`
 * has no UPDATE policy for API roles, so a session write changed nothing.
 *
 * Body: { diagnostic_id }
 */
export async function POST(req: NextRequest) {
  try {
    const { diagnostic_id } = await req.json()
    if (!diagnostic_id) {
      return NextResponse.json({ ok: false, error: 'diagnostic_id required' }, { status: 400 })
    }

    const sb = createServerClient()

    // SECURITY (audit 2026-07-02): require a session (this is called from the
    // dashboard "retry" button) and throttle — it re-fires the paid AI fan-out.
    const user = await getSessionUser(sb)
    if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    if (await isRateLimitedKey(user.id, 'diagnostics-retry-ai', { max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    // Get the user_id from the diagnostic
    const { data: diag, error: diagErr } = await sb
      .from('diagnostics')
      .select('user_id')
      .eq('id', diagnostic_id)
      .single()

    if (diagErr || !diag) {
      return NextResponse.json({ ok: false, error: 'Diagnostic not found' }, { status: 404 })
    }

    // Owner-or-staff only.
    if (diag.user_id !== user.id && !isStaffRole(await getSessionRole(sb, user.id))) {
      return NextResponse.json({ ok: false, error: 'Diagnostic not found' }, { status: 404 })
    }

    // Mark processing; keep the previous analysis until the new one arrives.
    const { error: markErr } = await createServiceClient()
      .from('diagnostics')
      .update({ ai_status: 'processing' })
      .eq('id', diagnostic_id)
      .eq('user_id', diag.user_id)
    if (markErr) {
      console.error('[retry-ai] status update failed', markErr.code ?? '', markErr.message ?? '')
      return NextResponse.json({ ok: false, error: 'Не удалось перезапустить анализ' }, { status: 500 })
    }

    // Fire AI analysis asynchronously (signed internal token — no cookies here)
    const baseUrl = req.nextUrl.origin
    fetch(`${baseUrl}/api/v1/diagnostics/ai-analyze`, {
      method: 'POST',
      headers: internalFetchHeaders(),
      body: JSON.stringify({ diagnostic_id, user_id: diag.user_id }),
    }).catch(err => console.error('[retry-ai] Failed to fire ai-analyze:', err))

    return NextResponse.json({ ok: true, ai_status: 'processing' })
  } catch (error) {
    console.error('[retry-ai] Error:', error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
