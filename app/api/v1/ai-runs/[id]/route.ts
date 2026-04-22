/**
 * GET /api/v1/ai-runs/[id]
 *
 * Returns the ai_runs row for a given run id. Used by the AiProgressStrip
 * component on the client dashboard to show live progress.
 *
 * Access: the owner of the run (user_id match) or staff (expert/admin/
 * super_admin). Enforced via Supabase RLS — we just forward the cookie
 * session to the server client.
 */

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  }

  const sb = createServerClient()
  const { data, error } = await sb
    .from('ai_runs')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, data })
}
