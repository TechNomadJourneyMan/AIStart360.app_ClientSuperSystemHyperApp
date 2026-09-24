export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { listPendingSuggestions } from '@/lib/documents/survey-suggestions'

/**
 * GET /api/v1/onboarding/suggestions → { ok, data: SurveySuggestion[] }
 *
 * Survey answers found in the caller's parsed documents that are still waiting
 * for «Принять» (F-076). Only keys without an answer are returned. Identity from
 * the session only (IDOR-safe); the table is service-role only (migration 091).
 */
export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const data = await listPendingSuggestions(createServiceClient(), user.id)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    // Migration not applied / DB hiccup → the wizard simply shows no chips.
    console.warn('[onboarding/suggestions] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, data: [] })
  }
}
