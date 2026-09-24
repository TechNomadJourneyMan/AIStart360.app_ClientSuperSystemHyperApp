export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { STATUS_UPDATE_FAILED } from '@/lib/admin/status-messages'

/**
 * POST /api/giga-admin/users/:id/unblock { reason? }
 *
 * Reverses a persistent block: profiles.status → 'approved' and the GoTrue ban
 * is lifted, restoring the user's ability to sign in. Required audit entry is
 * written first; a failed status update leaves a `user.unblock_failed` entry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const actor = guard.actor
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const { id } = params
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null

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

    try {
      await recordAdminAction(actor, {
        action: 'user.unblocked',
        entityType: 'user', entityId: id, targetUserId: id,
        oldValue: { status: 'blocked' }, newValue: { status: 'approved' },
        metadata: reason ? { reason } : {},
      }, req, { required: true })
    } catch {
      return NextResponse.json({ error: 'Журнал действий недоступен — разблокировка не выполнена' }, { status: 503 })
    }

    const { data: updated, error: updErr } = await svc
      .from('profiles')
      .update({ status: 'approved' })
      .eq('id', id)
      .select('id')
    if (updErr || !updated || updated.length === 0) {
      console.error('[giga-admin/unblock] profiles.status update failed:', updErr?.message)
      await recordAdminAction(actor, {
        action: 'user.unblock_failed',
        entityType: 'user', entityId: id, targetUserId: id,
        oldValue: { status: 'blocked' }, newValue: { status: 'blocked' },
        metadata: { ...(reason ? { reason } : {}), error: (updErr?.message ?? 'profile row not updated').slice(0, 300) },
      }, req).catch(() => false)
      return NextResponse.json({ error: STATUS_UPDATE_FAILED }, { status: 409 })
    }

    try {
      await svc.auth.admin.updateUserById(id, { ban_duration: 'none' })
    } catch (e) {
      console.error('[giga-admin/unblock] GoTrue unban failed:', e)
    }

    return NextResponse.json({ success: true, message: 'Пользователь разблокирован' })
  } catch (error) {
    console.error('[giga-admin/unblock] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
