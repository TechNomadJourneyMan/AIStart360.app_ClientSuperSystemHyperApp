export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { auditReject } from '@/lib/audit'
import { applyApprovalDecision } from '@/lib/users/approval'

/**
 * POST /api/admin/requests/:id/reject
 * Body: { reason: string }
 *
 * Reject a request with a mandatory reason.
 * State machine: new | in_review | waiting_for_info | escalated → rejected
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, error } = await requirePermission('requests:approve')
  if (error) return error

  const body = await req.json()
  const { reason } = body

  if (!reason?.trim()) {
    return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })
  }

  const request = await prisma.adminRequest.findUnique({ where: { id: params.id } })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const REJECTABLE = ['new', 'in_review', 'waiting_for_info', 'escalated']
  if (!REJECTABLE.includes(request.status)) {
    return NextResponse.json(
      { error: `Cannot reject a request with status "${request.status}"` },
      { status: 422 },
    )
  }

  const updated = await prisma.adminRequest.update({
    where: { id: params.id },
    data: { status: 'rejected', rejectionReason: reason.trim() },
  })

  // SINGLE SOURCE OF TRUTH: mirror the rejection into profiles.status (what the
  // client login reads), resolved by the request's email.
  const rejectEmail = (request.payload as Record<string, string> | null)?.email
  if (rejectEmail) {
    const { affected } = await applyApprovalDecision({ email: rejectEmail, status: 'rejected', reason: reason.trim() })
    if (affected === 0) {
      console.warn(`[admin/requests/reject] no profiles row for ${rejectEmail}`)
    }
  }

  await auditReject(params.id, session.user.id, reason.trim(), { status: request.status })

  return NextResponse.json({ data: updated, message: 'Request rejected' })
}
