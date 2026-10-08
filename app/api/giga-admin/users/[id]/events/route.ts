export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { EVENT_TYPES } from '@/lib/events/registry'
import { guardClientAccess } from '@/lib/admin/client-scope'

// GET /api/giga-admin/users/:id/events?page=&type=&source= — activity timeline.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 50

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'activity.view')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const type = sp.get('type') ?? ''
  const source = sp.get('source') ?? ''
  const hidePageViews = sp.get('pageviews') === '0'

  let q = createServiceClient()
    .from('user_events')
    .select('id, event_name, event_type, page, entity_type, entity_id, metadata, source, session_id, impersonation_session_id, created_at', { count: 'exact' })
    .eq('user_id', params.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1)
  if ((EVENT_TYPES as readonly string[]).includes(type)) q = q.eq('event_type', type)
  if (['web', 'server', 'admin', 'impersonation', 'backfill'].includes(source)) q = q.eq('source', source)
  if (hidePageViews) q = q.neq('event_name', 'PAGE_VIEWED')
  const { data, count, error } = await q
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить события' }, { status: 500 })
  return NextResponse.json({ ok: true, data: data ?? [], total: count ?? 0, page, pageSize: PAGE })
}
