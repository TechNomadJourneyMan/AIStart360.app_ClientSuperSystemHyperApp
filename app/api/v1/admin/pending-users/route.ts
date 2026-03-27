import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// GET /api/v1/admin/pending-users
export async function GET() {
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
