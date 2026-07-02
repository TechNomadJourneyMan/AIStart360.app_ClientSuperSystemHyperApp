export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/current-user'

/**
 * GET /api/v1/me — current user's ID from the Supabase session.
 *
 * The forgeable `aistart360_user_id` / `aistart360_role` cookies are no longer
 * consulted: reading them first let a caller impersonate any user (IDOR).
 * See lib/current-user.ts and audit 2026-07-02.
 */
export async function GET() {
  const userId = await getSessionUserId()
  return NextResponse.json({
    userId,
    source: userId ? 'supabase' : null,
  })
}
