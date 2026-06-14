export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireSupabaseAdmin } from '@/lib/supabase-admin-guard'

// GET /api/v1/admin/pending-users — admin only. See technical-audit A1.
export async function GET() {
  const guard = await requireSupabaseAdmin()
  if ('error' in guard) return guard.error

  const sb = createServerClient()

  const { data, error } = await sb
    .from('profiles')
    .select(`
      id, email, full_name, organization, position, phone, status, created_at,
      companies ( name, industry, stage )
    `)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data: data ?? [] })
}
