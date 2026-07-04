export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireSupabaseAdmin } from '@/lib/supabase-admin-guard'
import { applyApprovalDecision } from '@/lib/users/approval'

// POST /api/v1/admin/users/[id]/approve — admin only. See technical-audit A1.
// Writes profiles.status through the single source of truth (service role +
// affected-row check + user email).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireSupabaseAdmin()
  if ('error' in guard) return guard.error

  const { id } = params
  const body = await req.json().catch(() => ({}))
  const approvedBy = body.approved_by ?? guard.user.id

  const result = await applyApprovalDecision({ userId: id, status: 'approved', approvedBy })

  if (result.affected === 0) {
    return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, data: { id, status: 'approved' }, emailSent: result.emailSent })
}
