export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { EVENT_TYPES, isEventName } from '@/lib/events/registry'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail } from '@/lib/admin/mask'
import { NO_ID, scopedClientIds } from '@/lib/admin/client-scope'

// GET /api/giga-admin/activity?days=&page=&event=&type=&source=&pageviews=0
// Aggregates (SQL admin_activity_stats) + a filtered event stream.
const PAGE = 50

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'activity.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const days = Math.min(180, Math.max(1, Number(sp.get('days')) || 14))
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const sb = createServiceClient()

  let q = sb
    .from('user_events')
    .select('id, user_id, event_name, event_type, page, entity_type, entity_id, metadata, source, created_at', { count: 'exact' })
    .gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1)
  const event = sp.get('event') ?? ''
  if (isEventName(event)) q = q.eq('event_name', event)
  const type = sp.get('type') ?? ''
  if ((EVENT_TYPES as readonly string[]).includes(type)) q = q.eq('event_type', type)
  const source = sp.get('source') ?? ''
  if (['web', 'server', 'admin', 'impersonation', 'backfill'].includes(source)) q = q.eq('source', source)
  else q = q.neq('source', 'backfill')
  if (sp.get('pageviews') === '0') q = q.neq('event_name', 'PAGE_VIEWED')
  // Эксперт со scope 'assigned' видит ленту событий только своих клиентов.
  const allowed = await scopedClientIds(guard.actor)
  if (allowed) q = q.in('user_id', allowed.length ? allowed : [NO_ID])

  const [stats, stream] = await Promise.all([sb.rpc('admin_activity_stats', { p_days: days }), q])
  if (stats.error || stream.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить активность' }, { status: 500 })

  const ids = Array.from(new Set((stream.data ?? []).map((e) => e.user_id).filter(Boolean))) as string[]
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null }> }
  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const byId = new Map((people ?? []).map((p) => [p.id, { ...p, email: sensitive ? p.email : maskEmail(p.email) }]))

  return NextResponse.json({
    ok: true,
    stats: stats.data,
    data: (stream.data ?? []).map((e) => ({ ...e, user: e.user_id ? byId.get(e.user_id) ?? null : null })),
    total: stream.count ?? 0,
    page,
    pageSize: PAGE,
  })
}
