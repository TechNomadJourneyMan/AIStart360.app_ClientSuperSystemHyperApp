export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireSupabaseAdmin } from '@/lib/supabase-admin-guard'

// POST /api/v1/admin/users/[id]/reject — admin only. See technical-audit A1.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireSupabaseAdmin()
  if ('error' in guard) return guard.error

  const { id } = params
  const body = await req.json().catch(() => ({}))
  const status = body.status === 'requires_clarification' ? 'requires_clarification' : 'rejected'

  const sb = createServerClient()

  const { error } = await sb
    .from('profiles')
    .update({ status })
    .eq('id', id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data: { id, status } })
}
