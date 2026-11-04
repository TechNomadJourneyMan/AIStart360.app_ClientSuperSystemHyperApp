export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isAdmin } from '@/lib/api-auth'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
    if (!(await isAdmin())) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }
  const { id } = params
  const body = await req.json().catch(() => ({}))
  const approvedBy = body.approved_by ?? null

  const sb = createServerClient()

  const { error } = await sb
    .from('profiles')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    })
    .eq('id', id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data: { id, status: 'approved' } })
}
