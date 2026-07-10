export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServiceClient } from '@/lib/supabase-service'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/giga-admin/users/:id/block
 *
 * PERSISTENT block (R4). Previously this route only deleted (dead) NextAuth
 * sessions — nothing stopped the user from simply logging in again. Now it:
 *   1. sets profiles.status = 'blocked' (migration 059) — the login flow,
 *      middleware and rbac demotion all key off this;
 *   2. bans the GoTrue user (ban_duration) so existing refresh tokens die and
 *      new sign-ins are rejected at the auth layer;
 *   3. keeps the legacy Prisma-session cleanup (harmless, best-effort);
 *   4. writes an audit entry attributed to the real actor.
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

  // Self-block guard: a session admin must not lock themselves out.
  if (actor.kind === 'session' && actor.id === id) {
    return NextResponse.json({ error: 'Нельзя заблокировать собственный аккаунт' }, { status: 422 })
  }

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

    // 1. Persistent status — verify the row actually changed (RLS-null lesson).
    const { data: updated, error: updErr } = await svc
      .from('profiles')
      .update({ status: 'blocked' })
      .eq('id', id)
      .select('id')
    if (updErr || !updated || updated.length === 0) {
      console.error('[giga-admin/block] profiles.status update failed:', updErr?.message)
      return NextResponse.json(
        { error: 'Статус не обновлён (применена ли миграция 059?)' },
        { status: 409 },
      )
    }

    // 2. Kill auth: ban the GoTrue user (revokes refresh, rejects new logins).
    try {
      await svc.auth.admin.updateUserById(id, { ban_duration: '87600h' })
    } catch (e) {
      console.error('[giga-admin/block] GoTrue ban failed (status still blocked):', e)
    }

    // 3. Legacy NextAuth sessions (best-effort).
    try {
      await prisma.session.deleteMany({ where: { userId: id } })
    } catch {
      // Prisma table may be empty/absent in this environment — non-fatal.
    }

    await logAudit({
      entityType: 'user',
      entityId: id,
      action: 'user.blocked',
      performedBy: actor.id,
      diff: {
        before: { status: (target as { status?: string }).status },
        after: { status: 'blocked', authBanned: true },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ success: true, message: `Пользователь ${id} заблокирован` })
  } catch (error) {
    console.error('[giga-admin/block] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
