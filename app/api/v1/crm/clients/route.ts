export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateClient, CLIENT_STATUSES } from '@/lib/crm/client-validate'

const MAX_CLIENTS = 500

export async function GET(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const statusParam = request.nextUrl.searchParams.get('status')

  let query = sb
    .from('crm_clients')
    .select('*')
    .eq('user_id', userData.user.id)

  if (statusParam) {
    if (!(CLIENT_STATUSES as readonly string[]).includes(statusParam)) {
      return NextResponse.json({ ok: false, error: 'invalid status' }, { status: 400 })
    }
    query = query.eq('status', statusParam)
  }

  // Очередь: сначала по next_contact_at (ближайшие), NULLS LAST, затем свежие.
  const { data, error } = await query
    .order('next_contact_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(MAX_CLIENTS)

  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  return NextResponse.json({ ok: true, data: { clients: data ?? [] } })
}

export async function POST(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const parsed = validateClient(body)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

  const value = { ...parsed.value }
  if (value.source == null) value.source = 'manual'

  const { data, error } = await sb
    .from('crm_clients')
    // user_id ВСЕГДА из сессии, никогда из тела.
    .insert({ ...value, user_id: userData.user.id })
    .select('*')
    .single()

  if (error) {
    // Уникальный индекс (user_id, phone) → телефон уже есть в базе.
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, error: 'phone_conflict', message: 'Клиент с таким телефоном уже есть' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: { client: data } })
}
