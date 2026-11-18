export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmInteractionBody } from '@/lib/validation/schemas'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Касания, которые пользователь фиксирует вручную (status_change пишет система):
// CRM_LOGGABLE_KINDS в lib/validation/schemas.ts.
const COMMENT_MAX = 2000
/** Interactions that are a contact with the client (a note is not). */
const CONTACT_KINDS: ReadonlySet<string> = new Set(['call', 'message', 'meeting'])

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

  // R-149: { kind, comment? } only; an unknown kind is a 400 with field 'kind'.
  const body = await parseJsonBody(request, CrmInteractionBody)
  if (!body.ok) return body.response
  const { kind } = body.data
  const comment = body.data.comment == null ? null : body.data.comment.trim().slice(0, COMMENT_MAX) || null

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

  // Only a CONTACT (call / message / meeting) is a contact: it moves last_contact_at — «Обработано
  // сегодня» and the queue (lib/crm/today.ts) go by it — and closes the client's open reminders
  // that were due by now: the contact is what they asked for. A note is just a note: it changes
  // neither, so writing a note never takes a client off «Кому звонить сегодня».
  if (CONTACT_KINDS.has(kind)) {
    const now = new Date().toISOString()
    await sb
      .from('crm_clients')
      .update({ last_contact_at: now, updated_at: now })
      .eq('id', params.id)
      .eq('user_id', userId)
    await sb
      .from('crm_reminders')
      .update({ status: 'done', done_at: now })
      .eq('client_id', params.id)
      .eq('user_id', userId)
      .eq('status', 'open')
      .lte('due_at', now)
  }

  return NextResponse.json({ ok: true, data: { interaction: data } })
}
