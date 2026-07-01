import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Mark one notification read, or archive it. Self-scoped (RLS enforces ownership).
export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { archive?: boolean }
  const update = body.archive
    ? { archived_at: new Date().toISOString() }
    : { is_read: true, read_at: new Date().toISOString() }

  const { error } = await supabase
    .from('app_notifications')
    .update(update)
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[api/v1/notifications/[id] PATCH]', error)
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
