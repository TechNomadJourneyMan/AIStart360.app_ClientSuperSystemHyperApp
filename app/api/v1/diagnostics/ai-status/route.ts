export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

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
  const { data, error } = await sb
    .from('diagnostics')
    .select('ai_status, ai_analysis')
    .eq('id', diagnosticId)
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      ai_status: data?.ai_status ?? 'none',
      ai_analysis: data?.ai_analysis ?? null,
    },
  })
}
