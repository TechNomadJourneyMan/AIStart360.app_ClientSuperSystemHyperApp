export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { devAccessEnabledForRequest, devNotFound } from '@/lib/dev/dev-access'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/dev/logout — ends the Supabase session of this browser; the
 * dev-mode cookie stays. Dev-only: 404 unless lib/dev/dev-access.ts allows the
 * request, and in a production build that guard is the constant `false`.
 */
export async function POST(request: NextRequest) {
  if (!devAccessEnabledForRequest(request)) return devNotFound()

  try {
    const supabase = await createClient()
    // Local scope: the default (global) would end every session of the account —
    // for a real account entered by e-mail, on every device its owner uses.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[dev/logout]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'DEV_LOGOUT_FAILED' }, { status: 500 })
  }
}

// Any other method: there is no such route (Next.js would answer 405 / 204).
export { devNotFound as GET, devNotFound as PUT, devNotFound as PATCH, devNotFound as DELETE, devNotFound as OPTIONS }
