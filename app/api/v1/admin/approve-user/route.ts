import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireSupabaseAdmin } from '@/lib/supabase-admin-guard'

// POST /api/v1/admin/approve-user — admin only. Previously unauthenticated,
// which allowed anyone to approve/reject any account. See technical-audit A1.
export async function POST(req: Request) {
  try {
    const guard = await requireSupabaseAdmin()
    if ('error' in guard) return guard.error

    const sb = createServerClient()
    const { userId, status } = await req.json()

    if (!userId || !status) {
      return NextResponse.json({ ok: false, error: 'Missing userId or status' }, { status: 400 })
    }

    // Only allow valid statuses to be set using this route
    if (!['approved', 'rejected', 'pending_approval'].includes(status)) {
       return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
    }

    const { data, error } = await sb
      .from('profiles')
      .update({ status })
      .eq('id', userId)

    if (error) throw error

    return NextResponse.json({ ok: true, data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
