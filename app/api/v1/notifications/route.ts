import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Self-scoped in-app notification feed (app_notifications). RLS also enforces
// user_id = auth.uid(). GET lists (optionally unread-only) + returns unread count;
// PATCH marks all as read.
export const dynamic = 'force-dynamic'

const SELECT = 'id, category, priority, title, body, link, is_read, created_at'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const filter = new URL(request.url).searchParams.get('filter')

  let query = supabase
    .from('app_notifications')
    .select(SELECT)
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(100)
  if (filter === 'unread') query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) {
    console.error('[api/v1/notifications GET]', error)
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 })
  }

  const { count } = await supabase
    .from('app_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
    .is('archived_at', null)

  return NextResponse.json({ ok: true, data: data ?? [], unread: count ?? 0 })
}

// Mark all as read.
export async function PATCH() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('app_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_read', false)

  if (error) {
    console.error('[api/v1/notifications PATCH]', error)
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
