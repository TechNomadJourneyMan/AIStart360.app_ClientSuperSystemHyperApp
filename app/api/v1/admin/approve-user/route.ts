import { NextResponse } from 'next/server'
import { forbidLegacyTarget, requireSupabaseAdmin } from '@/lib/supabase-admin-guard'
import { recordAdminAction } from '@/lib/admin/audit'
import { applyApprovalDecision, type ProfileStatus } from '@/lib/users/approval'

// POST /api/v1/admin/approve-user — admin only. Previously unauthenticated,
// which allowed anyone to approve/reject any account. See technical-audit A1.
//
// Writes go through the single source of truth (profiles.status via service
// role) so this path cannot diverge from the giga/​v1 paths, and a 0-row update
// surfaces as 404 instead of a silent success.
export async function POST(req: Request) {
  try {
    const guard = await requireSupabaseAdmin()
    if ('error' in guard) return guard.error

    const { userId, status } = await req.json()

    if (!userId || !status) {
      return NextResponse.json({ ok: false, error: 'Missing userId or status' }, { status: 400 })
    }

    // Only allow valid statuses to be set using this route
    if (!['approved', 'rejected', 'pending_approval'].includes(status)) {
      return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
    }

    const denied = await forbidLegacyTarget(guard, String(userId))
    if (denied) return denied
    await recordAdminAction(
      { id: guard.user.id, kind: 'session', role: guard.role, email: guard.user.email ?? undefined },
      { action: 'user.approval_decision', entityType: 'profile', entityId: String(userId), targetUserId: String(userId), newValue: { status }, metadata: { via: 'api/v1/admin/approve-user' } },
      req,
      { required: true },
    )

    const result = await applyApprovalDecision({
      userId,
      status: status as ProfileStatus,
      approvedBy: status === 'approved' ? guard.user.id : null,
    })

    if (result.affected === 0) {
      return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: { id: userId, status }, emailSent: result.emailSent })
  } catch (err) {
    console.error('[v1/admin/approve-user]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}
