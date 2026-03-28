export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { auditApprove } from '@/lib/audit'

/**
 * POST /api/admin/requests/:id/approve
 *
 * Approve a request. State machine:
 *   new | in_review | waiting_for_info → approved
 *
 * On registration approval: creates a User record if userId is null.
 * On access approval: updates the user's role/permissions (via payload.targetRole).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, error } = await requirePermission('requests:approve')
  if (error) return error

  const request = await prisma.adminRequest.findUnique({
    where: { id: params.id },
    include: { user: true, company: true },
  })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const APPROVABLE = ['new', 'in_review', 'waiting_for_info', 'escalated']
  if (!APPROVABLE.includes(request.status)) {
    return NextResponse.json(
      { error: `Cannot approve a request with status "${request.status}"` },
      { status: 422 },
    )
  }

  // Side effects by request type
  if (request.type === 'registration' && !request.userId) {
    const payload = (request.payload as Record<string, string> | null) ?? {}
    if (payload.email) {
      // Create the user record
      await prisma.user.upsert({
        where: { email: payload.email },
        create: {
          email: payload.email,
          name: payload.name ?? null,
          role: 'CLIENT',
        },
        update: { status: 'active' },
      })
    }
  }

  if (request.type === 'access' && request.userId) {
    const payload = (request.payload as Record<string, string> | null) ?? {}
    if (payload.targetRole) {
      await prisma.user.update({
        where: { id: request.userId },
        data: { role: payload.targetRole as never },
      })
    }
  }

  // Activate company if it was a lead
  if (request.companyId) {
    await prisma.company.update({
      where: { id: request.companyId },
      data: { status: 'active' },
    })
  }

  const updated = await prisma.adminRequest.update({
    where: { id: params.id },
    data: { status: 'approved' },
  })

  await auditApprove(params.id, session.user.id, { status: request.status })

  return NextResponse.json({ data: updated, message: 'Request approved' })
}
