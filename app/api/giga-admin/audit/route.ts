export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'

// GET /api/giga-admin/audit?page=&action=&actor=&target=&from=&to=&imp=1
const PAGE = 40
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'audit.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const sb = createServiceClient()
  let q = sb
    .from('admin_audit_log')
    .select('id, actor_id, actor_kind, actor_role, actor_email, target_user_id, impersonation_session_id, action, entity_type, entity_id, old_value, new_value, metadata, ip_address, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1)
  const action = (sp.get('action') ?? '').trim()
  if (/^[a-z_.]{2,60}$/.test(action)) q = q.like('action', `${action}%`)
  const actor = (sp.get('actor') ?? '').trim()
  if (actor && actor.length <= 80) q = q.or(`actor_id.eq.${actor.replace(/[,()]/g, '')},actor_email.ilike.%${actor.replace(/[,()%]/g, '')}%`)
  const target = sp.get('target') ?? ''
  if (UUID_RE.test(target)) q = q.eq('target_user_id', target)
  const from = sp.get('from')
  if (from && !Number.isNaN(Date.parse(from))) q = q.gte('created_at', new Date(from).toISOString())
  const to = sp.get('to')
  if (to && !Number.isNaN(Date.parse(to))) q = q.lte('created_at', new Date(to).toISOString())
  if (sp.get('imp') === '1') q = q.not('impersonation_session_id', 'is', null)

  const { data, count, error } = await q
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить журнал' }, { status: 500 })
  const ids = Array.from(new Set((data ?? []).map((r) => r.target_user_id).filter(Boolean))) as string[]
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p]))
  return NextResponse.json({
    ok: true,
    data: (data ?? []).map((r) => ({ ...r, target: r.target_user_id ? byId.get(r.target_user_id) ?? null : null })),
    total: count ?? 0,
    page,
    pageSize: PAGE,
  })
}
