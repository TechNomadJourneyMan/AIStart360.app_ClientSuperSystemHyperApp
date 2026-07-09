export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateClient, type ClientStatus } from '@/lib/crm/client-validate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_LABELS: Record<ClientStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  customer: 'Клиент',
  sleeping: 'Спящий',
  lost: 'Потерян',
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const parsed = validateClient(body, { partial: true })
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  if (Object.keys(parsed.value).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })
  }

  // Текущее состояние (own) — нужно, чтобы понять, изменился ли статус.
  const { data: current, error: curErr } = await sb
    .from('crm_clients')
    .select('status')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (curErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!current) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const patch = { ...parsed.value, updated_at: new Date().toISOString() }

  const { data, error } = await sb
    .from('crm_clients')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', userId)
    .select('*')

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, error: 'phone_conflict', message: 'Клиент с таким телефоном уже есть' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  // Урок аудита 2026-07-04: всегда проверять число затронутых строк.
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Смена статуса → фиксируем касание в таймлайне.
  const newStatus = parsed.value.status
  if (newStatus && newStatus !== current.status) {
    const oldLabel = STATUS_LABELS[current.status as ClientStatus] ?? current.status
    const newLabel = STATUS_LABELS[newStatus] ?? newStatus
    await sb.from('crm_interactions').insert({
      client_id: params.id,
      user_id: userId,
      kind: 'status_change',
      comment: `Статус: ${oldLabel} → ${newLabel}`,
    })
  }

  return NextResponse.json({ ok: true, data: { client: data[0] } })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }
  const { data, error } = await sb
    .from('crm_clients')
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
