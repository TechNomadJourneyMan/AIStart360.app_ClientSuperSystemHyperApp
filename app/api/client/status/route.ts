export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/client/status
 * Returns the APPROVAL STATUS OF THE AUTHENTICATED USER only.
 *
 * The user id comes from the session — never from the query string — so this
 * endpoint can no longer be used to enumerate other users' approval status.
 * The read still uses the service role (direct REST) to avoid an RLS recursion
 * issue on profiles, but only for the caller's own id. See technical-audit A5.
 */
export async function GET(_req: NextRequest) {
  try {
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=status`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: 'no-store',
      }
    )

    // An internal failure must NOT be reported as 'pending_approval': callers
    // (the questionnaires, the waiting room) cannot tell a made-up status from
    // a real moderation verdict, and an approved user would be shown the
    // "on moderation" screen instead of his result. 503 = "unknown", which the
    // callers already handle as "check failed".
    if (!res.ok) {
      console.error('[client/status] REST API error:', res.status, await res.text())
      return NextResponse.json({ error: 'status_unavailable' }, { status: 503 })
    }

    const rows = await res.json() as Array<{ status: string }>
    const status = rows[0]?.status || 'pending_approval'
    return NextResponse.json({ status })
  } catch (error) {
    console.error('[client/status] error:', error)
    return NextResponse.json({ error: 'status_unavailable' }, { status: 503 })
  }
}
