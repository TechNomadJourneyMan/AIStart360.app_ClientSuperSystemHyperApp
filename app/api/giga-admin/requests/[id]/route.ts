export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { decideRequest, type RequestAction } from '@/lib/admin/request-decision'

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 *
 * The panel has no Supabase session for the target, so `auth.uid()` would be
 * NULL and RLS would silently drop an anon-client write (0 rows, no error).
 * The decision therefore goes through a SERVICE-ROLE client and VERIFIES the
 * profile row was actually updated before reporting success — see
 * lib/admin/request-decision.ts (shared with the bulk route).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Решение по заявке на доступ — отдельное право (см. lib/admin/rbac.ts):
  // им владеют Super Admin, Admin, CRM-менеджер и SuperExpert.
  const guard = await requireGiga(req, 'users.approve')
  if (guard.response) return guard.response

  const body = (await req.json()) as { action: RequestAction; reason?: string }
  if (!['approve', 'reject', 'archive'].includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    const r = await decideRequest(guard.actor, params.id, body.action, body.reason, req)
    if (!r.ok) {
      return NextResponse.json({ error: r.error, ...(r.userId ? { userId: r.userId } : {}) }, { status: r.httpStatus })
    }
    return NextResponse.json({ ok: true, status: r.status, userId: r.userId })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
