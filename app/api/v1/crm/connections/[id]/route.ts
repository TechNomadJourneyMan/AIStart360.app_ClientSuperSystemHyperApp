export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** DELETE — отключить СВОЁ подключение (RLS + явный user_id-скоуп). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }

  const { error } = await sb
    .from('crm_provider_connections')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
  if (error) {
    console.error('[crm/connections DELETE]', error)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
