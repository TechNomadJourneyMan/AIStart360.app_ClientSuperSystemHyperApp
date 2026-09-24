export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { guardClientAccess } from '@/lib/admin/client-scope'

// GET /api/giga-admin/users/:id/audit?page= — staff actions on this user
// (+ the admin sessions opened in their cabinet).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 30

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'audit.view')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const sb = createServiceClient()
  const [audit, sessions] = await Promise.all([
    sb.from('admin_audit_log')
      .select('id, actor_id, actor_kind, actor_role, actor_email, action, entity_type, entity_id, old_value, new_value, metadata, impersonation_session_id, ip_address, created_at', { count: 'exact' })
      .eq('target_user_id', params.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1),
    sb.from('impersonation_sessions')
      .select('id, admin_id, admin_email, admin_role, mode, reason, started_at, expires_at, ended_at, end_reason')
      .eq('target_user_id', params.id)
      .order('started_at', { ascending: false })
      .limit(20),
  ])
  if (audit.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить журнал' }, { status: 500 })
  return NextResponse.json({ ok: true, data: audit.data ?? [], sessions: sessions.data ?? [], total: audit.count ?? 0, page, pageSize: PAGE })
}
