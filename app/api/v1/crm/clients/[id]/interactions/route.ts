export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmInteractionBody } from '@/lib/validation/schemas'
import { almatyDay } from '@/lib/crm/today'

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
  // сегодня» and the queue (lib/crm/today.ts) go by it — and it FULFILS every plan of the client
  // due before the end of today's Almaty day that exists at this moment: the open reminders are
  // closed and a next contact planned for today (or missed) is cleared. A call at 11:00 answers
  // the plan for 15:00 made yesterday; a real call-back is planned AFTER the contact (a new
  // reminder / next contact), so it survives and keeps the client on today's list. Plans for later
  // days are untouched. A note is just a note: it changes nothing, so writing a note never takes a
  // client off «Кому звонить сегодня».
  if (CONTACT_KINDS.has(kind)) {
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()
    const endOfToday = new Date(almatyDay(nowMs).endMs).toISOString()
    const touched = await sb
      .from('crm_clients')
      .update({ last_contact_at: now, updated_at: now })
      .eq('id', params.id)
      .eq('user_id', userId)
    const planCleared = touched.error
      ? null
      : await sb
          .from('crm_clients')
          .update({ next_contact_at: null })
          .eq('id', params.id)
          .eq('user_id', userId)
          .lt('next_contact_at', endOfToday)
    const remindersClosed = touched.error || planCleared?.error
      ? null
      : await sb
          .from('crm_reminders')
          .update({ status: 'done', done_at: now })
          .eq('client_id', params.id)
          .eq('user_id', userId)
          .eq('status', 'open')
          .lt('due_at', endOfToday)
    // The touch is in the timeline, but the queue was not updated: say so — never a silent 200
    // that the screen reports as «зафиксировано» while the client stays in «Кому звонить».
    if (touched.error || planCleared?.error || remindersClosed?.error) {
      console.error('[crm/interactions] queue update failed', (touched.error ?? planCleared?.error ?? remindersClosed?.error)?.message)
      return NextResponse.json(
        {
          ok: false,
          error: 'queue_not_updated',
          code: 'queue_not_updated',
          message: 'Касание записано, но очередь «Кому звонить» не обновилась. Обновите страницу и повторите.',
        },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true, data: { interaction: data } })
}
