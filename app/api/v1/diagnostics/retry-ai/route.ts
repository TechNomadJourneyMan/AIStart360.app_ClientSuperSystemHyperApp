export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUserId, INTERNAL_HEADERS } from '@/lib/api-auth'

/**
 * POST /api/v1/diagnostics/retry-ai
 * Retries AI analysis for a diagnostic that previously failed.
 * Resets ai_status to 'processing' and fires the ai-analyze endpoint.
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

    // Get the user_id from the diagnostic
    const { data: diag, error: diagErr } = await sb
      .from('diagnostics')
      .select('user_id')
      .eq('id', diagnostic_id)
      .single()

    if (diagErr || !diag) {
      return NextResponse.json({ ok: false, error: 'Diagnostic not found' }, { status: 404 })
    }

    // Only the owner of the diagnostic may retry its AI analysis.
    const sessionUserId = await getSessionUserId()
    if (!sessionUserId || sessionUserId !== diag.user_id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Reset status
    await sb
      .from('diagnostics')
      .update({ ai_status: 'processing', ai_analysis: null })
      .eq('id', diagnostic_id)

    // Fire AI analysis asynchronously
    const baseUrl = req.nextUrl.origin
    fetch(`${baseUrl}/api/v1/diagnostics/ai-analyze`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify({ diagnostic_id, user_id: diag.user_id }),
    }).catch(err => console.error('[retry-ai] Failed to fire ai-analyze:', err))

    return NextResponse.json({ ok: true, ai_status: 'processing' })
  } catch (error) {
    console.error('[retry-ai] Error:', error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
