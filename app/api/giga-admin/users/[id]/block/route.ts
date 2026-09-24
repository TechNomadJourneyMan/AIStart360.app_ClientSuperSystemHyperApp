export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { STATUS_UPDATE_FAILED } from '@/lib/admin/status-messages'
import { guardClientAccess } from '@/lib/admin/client-scope'

/**
 * POST /api/giga-admin/users/:id/block { reason }
 *
 * PERSISTENT block (R4):
 *   1. writes a REQUIRED audit entry (actor role + email, reason) — no journal,
 *      no block;
 *   2. sets profiles.status = 'blocked' (migration 059) — the login flow,
 *      middleware and rbac demotion all key off this; if the update fails a
 *      compensating `user.block_failed` entry is written (the journal is
 *      append-only);
 *   3. bans the GoTrue user (ban_duration) so existing refresh tokens die and
 *      new sign-ins are rejected at the auth layer.
 */
const bodySchema = z.object({
  reason: z.string().trim().min(3, 'Укажите причину блокировки').max(300),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  const actor = guard.actor
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const { id } = params

  // Self-block guard: a session admin must not lock themselves out.
  if (actor.kind === 'session' && actor.id === id) {
    return NextResponse.json({ error: 'Нельзя заблокировать собственный аккаунт' }, { status: 422 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Укажите причину блокировки' }, { status: 400 })
  }
  const { reason } = parsed.data

  try {
    const svc = createServiceClient()

    // Never allow blocking another super_admin from the panel.
    const { data: target } = await svc
      .from('profiles')
      .select('id, role, status')
      .eq('id', id)
      .maybeSingle()
    if (!target) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    if ((target as { role?: string }).role === 'super_admin') {
      return NextResponse.json({ error: 'Нельзя заблокировать super_admin' }, { status: 403 })
    }
    const before = (target as { status?: string }).status ?? null

    // Journal BEFORE the action: if it cannot be written, nothing happens.
    try {
      await recordAdminAction(actor, {
        action: 'user.blocked',
        entityType: 'user', entityId: id, targetUserId: id,
        oldValue: { status: before }, newValue: { status: 'blocked', authBanned: true },
        metadata: { reason },
      }, req, { required: true })
    } catch {
      return NextResponse.json({ error: 'Журнал действий недоступен — блокировка не выполнена' }, { status: 503 })
    }

    // 1. Persistent status — verify the row actually changed (RLS-null lesson).
    const { data: updated, error: updErr } = await svc
      .from('profiles')
      .update({ status: 'blocked' })
      .eq('id', id)
      .select('id')
    if (updErr || !updated || updated.length === 0) {
      console.error('[giga-admin/block] profiles.status update failed:', updErr?.message)
      await recordAdminAction(actor, {
        action: 'user.block_failed',
        entityType: 'user', entityId: id, targetUserId: id,
        oldValue: { status: before }, newValue: { status: before },
        metadata: { reason, error: (updErr?.message ?? 'profile row not updated').slice(0, 300) },
      }, req).catch(() => false)
      return NextResponse.json({ error: STATUS_UPDATE_FAILED }, { status: 409 })
    }

    // 2. Kill auth: ban the GoTrue user (revokes refresh, rejects new logins).
    try {
      await svc.auth.admin.updateUserById(id, { ban_duration: '87600h' })
    } catch (e) {
      console.error('[giga-admin/block] GoTrue ban failed (status still blocked):', e)
    }

    return NextResponse.json({ success: true, message: 'Пользователь заблокирован' })
  } catch (error) {
    console.error('[giga-admin/block] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
