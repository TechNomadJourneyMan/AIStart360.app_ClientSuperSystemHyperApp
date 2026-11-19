export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmReminderPatchBody } from '@/lib/validation/schemas'

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

  const now = new Date().toISOString()
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

  // Выполнено → фиксируем касание и обновляем контактные даты клиента. «Выполнено» — это владелец
  // говорит, что запланированный контакт состоялся, поэтому last_contact_at двигается (а простая
  // заметка — нет: app/api/v1/crm/clients/[id]/interactions). «Отменено» контакта не означает.
  if (status === 'done') {
    await sb.from('crm_interactions').insert({
      client_id: current.client_id,
      user_id: userId,
      kind: 'note',
      comment: 'Напоминание выполнено',
    })
    const clientPatch: Record<string, unknown> = { last_contact_at: now, updated_at: now }
    if (nextContactAt) clientPatch.next_contact_at = nextContactAt
    await sb
      .from('crm_clients')
      .update(clientPatch)
      .eq('id', current.client_id)
      .eq('user_id', userId)
  }

  return NextResponse.json({ ok: true, data: { reminder: data[0] } })
}
