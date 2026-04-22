/**
 * POST /api/v1/ai-conflicts/[id]/resolve
 * Body: { winnerId: string, customValue?: unknown, note?: string }
 *
 * Resolves a pending ai_conflicts row by picking one of the contenders'
 * extraction ids as the winner, or supplying a custom value (which will
 * be written to metrics/ai_extractions as a manual entry).
 *
 * Access: company owner only (RLS policy ai_conflicts_owner_resolve).
 */

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  }

  let body: { winnerId?: string; customValue?: unknown; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  const sb = createServerClient()
  const { data: user } = await sb.auth.getUser()
  if (!user?.user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!body.winnerId) {
    return NextResponse.json(
      { ok: false, error: 'winnerId required (customValue path lands in Phase 3.1)' },
      { status: 400 }
    )
  }

  const { data, error } = await sb
    .from('ai_conflicts')
    .update({
      winner_id: body.winnerId,
      resolution: 'manual',
      resolved_by: user.user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'not found or forbidden' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, data })
}
