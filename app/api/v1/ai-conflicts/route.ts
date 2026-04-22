/**
 * GET /api/v1/ai-conflicts?company_id=xxx&resolution=pending
 *
 * Lists conflicts for a company. Used by /data-quality page and the
 * DataConflictModal. Owner-scoped via RLS policy ai_conflicts_owner_read.
 */

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('company_id')
  const resolution = req.nextUrl.searchParams.get('resolution')

  if (!companyId) {
    return NextResponse.json({ ok: false, error: 'company_id required' }, { status: 400 })
  }

  const sb = createServerClient()

  let query = sb
    .from('ai_conflicts')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (resolution) {
    query = query.eq('resolution', resolution)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data ?? [] })
}
