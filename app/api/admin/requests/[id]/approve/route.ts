export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { auditApprove } from '@/lib/audit'
import { applyApprovalDecision } from '@/lib/users/approval'

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
      // SECURITY (audit 2026-07-02): the target role must be a real UserRole,
      // and — mirroring the "only SUPER_ADMIN can change roles" control in
      // users/[id]/route.ts — only a SUPER_ADMIN approver may grant an elevated
      // (ADMIN / SUPER_ADMIN) role. Previously any ADMIN (who holds
      // requests:approve) could self-approve an `access` request carrying
      // targetRole='SUPER_ADMIN' and escalate. Now that path is closed and the
      // value is validated against the enum before it is ever written.
      const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ANALYST', 'CLIENT'] as const
      const ELEVATED = new Set(['SUPER_ADMIN', 'ADMIN'])
      const targetRole = payload.targetRole
      if (!VALID_ROLES.includes(targetRole as (typeof VALID_ROLES)[number])) {
        return NextResponse.json({ error: `Invalid target role: ${targetRole}` }, { status: 422 })
      }
      if (ELEVATED.has(targetRole) && session.user.role !== 'SUPER_ADMIN') {
        return NextResponse.json(
          { error: 'Only a SUPER_ADMIN may approve elevation to an admin role' },
          { status: 403 },
        )
      }
      await prisma.user.update({
        where: { id: request.userId },
        data: { role: targetRole as (typeof VALID_ROLES)[number] },
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

  // SINGLE SOURCE OF TRUTH: profiles.status is what the client login actually
  // reads to grant access. The Prisma users/admin_requests tables use different
  // ids, so resolve the Supabase profile by the request's email. approved_by is
  // left unset (the Prisma session id is not a profiles UUID).
  const approveEmail = request.user?.email ?? (request.payload as Record<string, string> | null)?.email
  if (approveEmail) {
    const { affected } = await applyApprovalDecision({ email: approveEmail, status: 'approved' })
    if (affected === 0) {
      console.warn(`[admin/requests/approve] no profiles row for ${approveEmail} — client access not granted`)
    }
  }

  await auditApprove(params.id, session.user.id, { status: request.status })

  return NextResponse.json({ data: updated, message: 'Request approved' })
}
