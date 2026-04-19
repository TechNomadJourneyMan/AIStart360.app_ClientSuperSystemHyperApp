export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isPrivilegedViewer } from '@/lib/expert-auth'

/**
 * GET /api/giga-admin/requests/[id]/diagnostics
 * Returns Point A diagnostics for the client associated with this request.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Read access: super_admin cookie OR Supabase session with expert/admin role
  const cookieRole = req.cookies.get('aistart360_role')?.value ?? null
  if (!(await isPrivilegedViewer(cookieRole))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServerClient()

    // Resolve userId: try admin_requests first, then treat id as profile id
    let userId: string | null = null
    const { data: arRow } = await sb
      .from('admin_requests')
      .select('payload')
      .eq('id', params.id)
      .maybeSingle()

    if (arRow) {
      userId = (arRow.payload as Record<string, string>)?.userId ?? null
    } else {
      userId = params.id
    }

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
