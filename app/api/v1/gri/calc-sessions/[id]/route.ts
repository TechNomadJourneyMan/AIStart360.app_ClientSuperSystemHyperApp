export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await sb
    .from('gri_calc_sessions')
    .delete()
    .eq('id', params.id)
    .eq('user_id', userData.user.id)
    .select('id')
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, data: { deleted: params.id } })
}
