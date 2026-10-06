export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireGiga } from '@/lib/admin/giga-actor'
import { decideAccessRequest } from '@/lib/users/access-requests'

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 *
 * The giga panel authenticates via a signed cookie and has NO Supabase auth
 * session, so `auth.uid()` is NULL and RLS would silently drop any write made
 * with the anon client (0 rows, no error). We therefore use a SERVICE-ROLE
 * client and VERIFY the profile row was actually updated before reporting
 * success — otherwise the UI shows "approved" while the DB stays pending.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Решение по заявке на доступ — отдельное право (см. lib/admin/rbac.ts):
  // им владеют Super Admin, Admin, CRM-менеджер и SuperExpert.
  const guard = await requireGiga(req, 'users.approve')
  if (guard.response) return guard.response
  const actor = guard.actor

  const body = (await req.json()) as { action: 'approve' | 'reject' | 'archive'; reason?: string }
  if (!['approve', 'reject', 'archive'].includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  let sb
  try {
    sb = createServiceClient()
  } catch (e) {
    console.error('[giga-admin/requests/:id] service client unavailable:', e)
    return NextResponse.json(
      { error: 'Сервер не сконфигурирован для этой операции (нет service-role ключа)' },
      { status: 500 },
    )
  }

  try {
    // Resolve the user, update the history row, write profiles.status through
    // the single source of truth and audit — lib/users/access-requests.ts
    // (shared with the admin Telegram bot).
    const res = await decideAccessRequest(sb, {
      requestId: params.id,
      action: body.action,
      reason: body.reason,
      actor: { id: actor.id, kind: actor.kind },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Профиль пользователя не найден — статус не изменён', userId: res.userId },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, status: res.status, userId: res.userId })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
