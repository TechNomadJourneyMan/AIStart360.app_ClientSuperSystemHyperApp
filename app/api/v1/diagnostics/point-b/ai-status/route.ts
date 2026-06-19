export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/v1/diagnostics/point-b/ai-status?diagnostic_id=xxx
 * Returns the Point B AI processing status + strategy for the session user's
 * current diagnostic. Session-scoped (never a user_id param) so one user can't
 * poll another's plan. Used by the client dashboard for polling.
 */
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve the diagnostic: passed id (scoped to this user) or the current one.
  let diagnosticId = req.nextUrl.searchParams.get('diagnostic_id')
  if (!diagnosticId) {
    const { data: diag } = await sb
      .from('diagnostics')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()
    diagnosticId = (diag?.id as string | undefined) ?? null
  } else {
    // Confirm the passed diagnostic belongs to the session user.
    const { data: owned } = await sb
      .from('diagnostics')
      .select('id')
      .eq('id', diagnosticId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!owned) diagnosticId = null
  }

  if (!diagnosticId) {
    return NextResponse.json({ ok: true, data: { ai_status: 'none', ai_strategy: null } })
  }

  const { data } = await sb
    .from('point_b_analysis')
    .select('ai_status, ai_strategy')
    .eq('diagnostic_id', diagnosticId)
    .eq('is_current', true)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    data: {
      ai_status: data?.ai_status ?? 'none',
      ai_strategy: data?.ai_strategy ?? null,
    },
  })
}
