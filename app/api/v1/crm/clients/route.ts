export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateClient, CLIENT_STATUSES } from '@/lib/crm/client-validate'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmClientBody } from '@/lib/validation/schemas'
import { PAGE_SIZE } from '@/lib/crm/today'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/v1/crm/clients?status=&limit=&after= — the owner's base, page by page.
 *
 * Keyset pagination in a stable order (by id): `limit` rows (1..PAGE_SIZE, default PAGE_SIZE) after
 * the row `after`. The answer carries `total` — how many clients match the filter — and
 * `nextCursor` (the `after` of the next page; null only on an empty page), so a caller can always tell
 * «показаны N из M» and reach every client. (It used to stop silently at 500 rows while a CSV import
 * accepts 2000.) Sorting for display is the caller's.
 */
export async function GET(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id
  const params = request.nextUrl.searchParams

  const statusParam = params.get('status')
  if (statusParam && !(CLIENT_STATUSES as readonly string[]).includes(statusParam)) {
    return NextResponse.json({ ok: false, error: 'invalid status' }, { status: 400 })
  }
  const after = params.get('after')
  if (after && !UUID_RE.test(after)) {
    return NextResponse.json({ ok: false, error: 'invalid after' }, { status: 400 })
  }
  const limitParam = params.get('limit')
  const limit = limitParam == null ? PAGE_SIZE : Number(limitParam)
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
    return NextResponse.json({ ok: false, error: `limit must be 1..${PAGE_SIZE}` }, { status: 400 })
  }

  let countQuery = sb.from('crm_clients').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  if (statusParam) countQuery = countQuery.eq('status', statusParam)
  const { count, error: countErr } = await countQuery
  if (countErr) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })

  let query = sb.from('crm_clients').select('*').eq('user_id', userId)
  if (statusParam) query = query.eq('status', statusParam)
  if (after) query = query.gt('id', after)
  const { data, error } = await query.order('id', { ascending: true }).limit(limit)
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })

  const clients = (data ?? []) as Array<{ id: string }>
  // The end is an EMPTY page: a short page is not the end when the server's max-rows is below
  // `limit`. A caller that has `total` rows can stop earlier (hooks/useCrm.ts fetchWholeBase).
  const nextCursor = clients.length > 0 ? clients[clients.length - 1].id : null
  return NextResponse.json({ ok: true, data: { clients, total: count ?? 0, nextCursor } })
}

export async function POST(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // R-149: types, caps and the key list (.strict(): no user_id / id / timestamps from the body).
  const body = await parseJsonBody(request, CrmClientBody)
  if (!body.ok) return body.response

  const parsed = validateClient(body.data)
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
