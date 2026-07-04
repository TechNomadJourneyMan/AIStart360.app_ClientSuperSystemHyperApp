export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireSupabaseAdmin } from '@/lib/supabase-admin-guard'
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
  const body = await req.json().catch(() => ({}))
  const status = body.status === 'requires_clarification' ? 'requires_clarification' : 'rejected'

  const result = await applyApprovalDecision({ userId: id, status, reason: body.reason })

  if (result.affected === 0) {
    return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, data: { id, status }, emailSent: result.emailSent })
}
