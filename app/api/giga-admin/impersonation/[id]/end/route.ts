export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'

// POST /api/giga-admin/impersonation/:id/end — close an open session from the
// panel. Middleware notices within seconds and signs the browser out of it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'impersonate.view')
  if (guard.response) return guard.response
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const sb = createServiceClient()
  const { data: row } = await sb.from('impersonation_sessions').select('id, admin_id, target_user_id, ended_at').eq('id', params.id).maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'Сессия не найдена' }, { status: 404 })
  if (row.ended_at) return NextResponse.json({ ok: true, alreadyEnded: true })
  // Ending someone else's session is an admin-level act.
  if (row.admin_id !== guard.actor.id && !['super_admin', 'admin'].includes(guard.actor.role)) {
    return NextResponse.json({ ok: false, error: 'Можно завершать только свои сессии' }, { status: 403 })
  }
  const reason = row.admin_id === guard.actor.id ? 'ended_by_admin' : 'terminated'
  await sb.from('impersonation_sessions').update({ ended_at: new Date().toISOString(), end_reason: reason }).eq('id', row.id).is('ended_at', null)
  await recordAdminAction(guard.actor, {
    action: 'impersonation.terminated',
    entityType: 'impersonation',
    entityId: row.id,
    targetUserId: row.target_user_id,
    impersonationSessionId: row.id,
    metadata: { reason, owner: row.admin_id },
  }, req)
  return NextResponse.json({ ok: true })
}
