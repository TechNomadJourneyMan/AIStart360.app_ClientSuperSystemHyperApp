export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authorizeUserDataRead, resolveRequestUserId } from '@/lib/admin/user-data-access'
import { loadSnapshotsByDiagnostic, officialDiagnosticRow, officialPointA } from '@/lib/point-a/official'

/**
 * GET /api/giga-admin/requests/[id]/diagnostics
 * Returns Point A diagnostics for the client associated with this request.
 * The diagnostics carry the client's finances: users.sensitive is required
 * (R-133), the client scope is checked by authorizeUserDataRead (R-047).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await authorizeUserDataRead(req, ['users.view', 'users.sensitive'], (sb) => resolveRequestUserId(sb, params.id))
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

    if (!diag) return NextResponse.json({ ok: true, data: null })
    // The OFFICIAL Point A (lib/point-a/official.ts, R-033/R-032): no score → null, a block without data → null.
    const snaps = await loadSnapshotsByDiagnostic(sb, [String((diag as { id: unknown }).id)])
    const official = officialPointA(diag as Record<string, unknown>, snaps.get(String((diag as { id: unknown }).id)) ?? null)
    return NextResponse.json({ ok: true, data: { ...officialDiagnosticRow(diag as Record<string, unknown>, official), assessment: official.state, blocks_without_data: official.blocksWithoutData } })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/diagnostics] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
