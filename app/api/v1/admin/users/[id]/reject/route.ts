export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { forbidLegacyTarget, requireSupabaseAdmin } from '@/lib/supabase-admin-guard'
import { recordAdminAction } from '@/lib/admin/audit'
import { applyApprovalDecision } from '@/lib/users/approval'

// POST /api/v1/admin/users/[id]/reject — admin only. See technical-audit A1.
// Writes profiles.status through the single source of truth (service role +
// affected-row check + user email).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireSupabaseAdmin()
  if ('error' in guard) return guard.error

  const { id } = params
  const denied = await forbidLegacyTarget(guard, id)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const status = body.status === 'requires_clarification' ? 'requires_clarification' : 'rejected'
  await recordAdminAction(
    { id: guard.user.id, kind: 'session', role: guard.role, email: guard.user.email ?? undefined },
    { action: 'user.approval_decision', entityType: 'profile', entityId: id, targetUserId: id, newValue: { status }, metadata: { via: 'api/v1/admin/users/reject' } },
    req,
    { required: true },
  )

  const result = await applyApprovalDecision({ userId: id, status, reason: body.reason })

  if (result.affected === 0) {
    return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, data: { id, status }, emailSent: result.emailSent })
}
