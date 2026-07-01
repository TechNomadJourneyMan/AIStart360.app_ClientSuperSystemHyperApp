import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Self-scoped read of the client's activity journal. RLS additionally enforces
// user_id = auth.uid(), so a user can only ever read their own rows.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10) || 100))

  let query = supabase
    .from('activity_log')
    .select('id, action, category, description, severity, status, metadata, ip_address, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (category && category !== 'all') query = query.eq('category', category)

  const { data, error } = await query
  if (error) {
    console.error('[api/v1/activity]', error)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: data ?? [] })
}
