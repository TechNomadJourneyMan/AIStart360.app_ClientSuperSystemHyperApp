export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/giga-admin/users/:id/unblock
 *
 * Reverses a persistent block: profiles.status → 'approved' and the GoTrue ban
 * is lifted, restoring the user's ability to sign in. Audited.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await getGigaActor(req)
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = params

  try {
    const svc = createServiceClient()

    const { data: target } = await svc
      .from('profiles')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (!target) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    if ((target as { status?: string }).status !== 'blocked') {
      return NextResponse.json({ error: 'Пользователь не заблокирован' }, { status: 422 })
    }

    const { data: updated, error: updErr } = await svc
      .from('profiles')
      .update({ status: 'approved' })
      .eq('id', id)
      .select('id')
    if (updErr || !updated || updated.length === 0) {
      return NextResponse.json({ error: 'Статус не обновлён' }, { status: 409 })
    }

    try {
      await svc.auth.admin.updateUserById(id, { ban_duration: 'none' })
    } catch (e) {
      console.error('[giga-admin/unblock] GoTrue unban failed:', e)
    }

    await logAudit({
      entityType: 'user',
      entityId: id,
      action: 'user.unblocked',
      performedBy: actor.id,
      diff: { before: { status: 'blocked' }, after: { status: 'approved' }, actorKind: actor.kind },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ success: true, message: `Пользователь ${id} разблокирован` })
  } catch (error) {
    console.error('[giga-admin/unblock] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
