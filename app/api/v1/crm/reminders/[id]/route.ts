export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmReminderPatchBody } from '@/lib/validation/schemas'
import { applyContact, queueNotUpdated } from '@/lib/crm/contact'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }
  const userId = userData.user.id

  // R-149: { status: done|dismissed, next_contact_at? } only.
  const body = await parseJsonBody(request, CrmReminderPatchBody)
  if (!body.ok) return body.response
  const { status } = body.data

  // next_contact_at опционален и валиден только при done — «предложить следующий контакт».
  let nextContactAt: string | undefined
  if (body.data.next_contact_at != null && body.data.next_contact_at !== '') {
    const d = new Date(body.data.next_contact_at)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ ok: false, error: 'next_contact_at must be an ISO date', code: 'invalid_body', field: 'next_contact_at' }, { status: 400 })
    }
    nextContactAt = d.toISOString()
  }

  // Напоминание должно принадлежать пользователю; нужен client_id для касания.
  const { data: current, error: curErr } = await sb
    .from('crm_reminders')
    .select('id, client_id, status')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (curErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!current) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  // Only a still-OPEN reminder is closed: a done one is not «done» twice (a second history entry, a
  // second move of the last contact) and does not become dismissed; a dismissed one stays so.
  const closed = () =>
    NextResponse.json(
      { ok: false, error: 'reminder_closed', code: 'reminder_closed', message: 'Напоминание уже закрыто' },
      { status: 409 },
    )
  if (current.status !== 'open') return closed()

  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const patch: Record<string, unknown> = { status }
  if (status === 'done') patch.done_at = now

  // `status = open` again in the UPDATE: two clicks at once close it once.
  const { data, error } = await sb
    .from('crm_reminders')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .select('*')
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!data || data.length === 0) return closed()

  // «Выполнено» — the owner says the planned contact happened: it is a CONTACT. A history entry,
  // then the same rule as a logged call (lib/crm/contact.ts): last_contact_at moves and every plan
  // due by the end of today is fulfilled; a next contact given with it is a call-back and stays.
  // «Отменено» is not a contact. Every write is checked — never a silent 200.
  if (status === 'done') {
    const failed = (what: string, e: { message?: string } | null) => {
      console.error(`[crm/reminders] ${what} failed`, e?.message)
      return NextResponse.json(
        queueNotUpdated('Напоминание отмечено выполненным, но очередь «Кому звонить» не обновилась. Обновите страницу.'),
        { status: 500 },
      )
    }
    const history = await sb.from('crm_interactions').insert({
      client_id: current.client_id,
      user_id: userId,
      kind: 'note',
      comment: 'Напоминание выполнено',
    })
    if (history.error) return failed('history entry', history.error)
    const applied = await applyContact(sb, { clientId: current.client_id, userId, nowMs, nextContactAt })
    if (!applied.ok) return failed('queue update', applied.error)
  }

  return NextResponse.json({ ok: true, data: { reminder: data[0] } })
}
