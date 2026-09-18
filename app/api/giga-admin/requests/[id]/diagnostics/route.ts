export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authorizeUserDataRead, resolveRequestUserId } from '@/lib/admin/user-data-access'

/**
 * GET /api/giga-admin/requests/[id]/diagnostics
 * Returns Point A diagnostics for the client associated with this request.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await authorizeUserDataRead(req, 'users.view', (sb) => resolveRequestUserId(sb, params.id))
  if ('response' in access) return access.response

  try {
    const sb = access.sb
    const userId = access.userId

    if (!userId) {
      return NextResponse.json({ ok: true, data: null })
    }

    // Get latest diagnostics
    const { data: diag, error } = await sb
      .from('diagnostics')
      .select('*')
      .eq('user_id', userId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[giga-admin/requests/[id]/diagnostics] error:', error.message)
      return NextResponse.json({ ok: true, data: null })
    }

    return NextResponse.json({ ok: true, data: diag })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/diagnostics] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
