export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Касания, которые пользователь фиксирует вручную (status_change пишет система).
const LOGGABLE_KINDS = ['call', 'message', 'meeting', 'note'] as const
const COMMENT_MAX = 2000

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }
  const userId = userData.user.id

  // Клиент должен принадлежать пользователю.
  const { data: client, error: cErr } = await sb
    .from('crm_clients')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!client) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const { data, error } = await sb
    .from('crm_interactions')
    .select('*')
    .eq('client_id', params.id)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  return NextResponse.json({ ok: true, data: { interactions: data ?? [] } })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }
  const userId = userData.user.id

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>
  const kind = String(b.kind ?? '')
  if (!(LOGGABLE_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ ok: false, error: 'invalid kind' }, { status: 400 })
  }
  const comment = b.comment == null ? null : String(b.comment).trim().slice(0, COMMENT_MAX) || null

  // Клиент должен принадлежать пользователю.
  const { data: client, error: cErr } = await sb
    .from('crm_clients')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!client) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const { data, error } = await sb
    .from('crm_interactions')
    .insert({ client_id: params.id, user_id: userId, kind, comment })
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })

  // Любое касание обновляет last_contact_at у клиента.
  const now = new Date().toISOString()
  await sb
    .from('crm_clients')
    .update({ last_contact_at: now, updated_at: now })
    .eq('id', params.id)
    .eq('user_id', userId)

  return NextResponse.json({ ok: true, data: { interaction: data } })
}
