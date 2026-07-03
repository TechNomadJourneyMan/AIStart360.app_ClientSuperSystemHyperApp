export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser, getSessionRole, isStaffRole } from '@/lib/api-identity'

/**
 * GET /api/v1/diagnostics/ai-status?diagnostic_id=xxx
 * Returns the AI processing status and analysis data for a diagnostic.
 * Used by the client dashboard for polling.
 */
export async function GET(req: NextRequest) {
  const diagnosticId = req.nextUrl.searchParams.get('diagnostic_id')
  if (!diagnosticId) {
    return NextResponse.json({ ok: false, error: 'diagnostic_id required' }, { status: 400 })
  }

  const sb = createServerClient()
  // SECURITY (audit 2026-07-02): require a session and scope the poll to the
  // owner (was anonymous + leaked raw DB error strings).
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('diagnostics')
    .select('ai_status, ai_analysis, user_id')
    .eq('id', diagnosticId)
    .single()

  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }
  if (data.user_id !== user.id && !isStaffRole(await getSessionRole(sb, user.id))) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      ai_status: data?.ai_status ?? 'none',
      ai_analysis: data?.ai_analysis ?? null,
    },
  })
}
