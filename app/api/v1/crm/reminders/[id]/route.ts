export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REMINDER_STATUSES = ['done', 'dismissed'] as const

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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const b = (body ?? {}) as Record<string, unknown>

  const status = String(b.status ?? '')
  if (!(REMINDER_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: 'status must be done or dismissed' }, { status: 400 })
  }

  // next_contact_at опционален и валиден только при done — «предложить следующий контакт».
  let nextContactAt: string | undefined
  if (b.next_contact_at != null && b.next_contact_at !== '') {
    const d = new Date(String(b.next_contact_at))
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ ok: false, error: 'next_contact_at must be an ISO date' }, { status: 400 })
    }
    nextContactAt = d.toISOString()
  }

  // Напоминание должно принадлежать пользователю; нужен client_id для касания.
  const { data: current, error: curErr } = await sb
    .from('crm_reminders')
    .select('id, client_id')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (curErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!current) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status }
  if (status === 'done') patch.done_at = now

  const { data, error } = await sb
    .from('crm_reminders')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', userId)
    .select('*')
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Выполнено → фиксируем касание и обновляем контактные даты клиента.
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
