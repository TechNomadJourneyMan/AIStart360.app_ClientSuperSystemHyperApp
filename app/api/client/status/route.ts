export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * GET /api/client/status
 * Returns the APPROVAL STATUS OF THE AUTHENTICATED USER only.
 *
 * The user id comes from the session — never from the query string — so this
 * endpoint can no longer be used to enumerate other users' approval status.
 *
 * The read runs under the caller's own session (RLS), not the service role.
 * The previous version hand-rolled a REST call keyed on
 * `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY`, which had two
 * problems: it escalated to a full RLS bypass just to read one own-profile
 * column, and the `||` fallback never fired for the literal `[SENSITIVE]` that
 * `vercel env pull` writes for protected variables — that placeholder was sent
 * to PostgREST as a real key, so every call 401'd and this endpoint answered
 * 503 for the whole local environment. The old "RLS recursion on profiles"
 * caveat is stale: reading own `profiles` row under a user JWT was verified to
 * return normally.
 */
export async function GET(_req: NextRequest) {
  try {
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await sb
      .from('profiles')
      .select('status')
      .eq('id', user.id)
      .maybeSingle()

    // An internal failure must NOT be reported as 'pending_approval': callers
    // (the questionnaires, the waiting room) cannot tell a made-up status from
    // a real moderation verdict, and an approved user would be shown the
    // "on moderation" screen instead of his result. 503 = "unknown", which the
    // callers already handle as "check failed".
    if (error) {
      console.error('[client/status] profiles read failed:', error.message)
      return NextResponse.json({ error: 'status_unavailable' }, { status: 503 })
    }

    const status = data?.status || 'pending_approval'
    return NextResponse.json({ status })
  } catch (error) {
    console.error('[client/status] error:', error)
    return NextResponse.json({ error: 'status_unavailable' }, { status: 503 })
  }
}
