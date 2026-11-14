export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmReminderBody } from '@/lib/validation/schemas'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTE_MAX = 2000

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

  const { data: client, error: cErr } = await sb
    .from('crm_clients')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!client) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const { data, error } = await sb
    .from('crm_reminders')
    .select('*')
    .eq('client_id', params.id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('due_at', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  return NextResponse.json({ ok: true, data: { reminders: data ?? [] } })
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

  // R-149: { due_at, note? } only.
  const body = await parseJsonBody(request, CrmReminderBody)
  if (!body.ok) return body.response
  const due = new Date(body.data.due_at)
  if (Number.isNaN(due.getTime())) {
    return NextResponse.json({ ok: false, error: 'due_at must be an ISO date', code: 'invalid_body', field: 'due_at' }, { status: 400 })
  }
  const note = body.data.note == null ? null : body.data.note.trim().slice(0, NOTE_MAX) || null

  const { data: client, error: cErr } = await sb
    .from('crm_clients')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!client) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const { data, error } = await sb
    .from('crm_reminders')
    .insert({
      client_id: params.id,
      user_id: userId,
      due_at: due.toISOString(),
      note,
      status: 'open',
    })
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })

  return NextResponse.json({ ok: true, data: { reminder: data } })
}
