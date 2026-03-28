import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/admin/requests/:id/request-info
 * Body: { message: string }
 *
 * Transitions a request to "waiting_for_info" and appends an internal comment
 * explaining what additional information is needed.
 * In production: also triggers an email to the requester via Resend.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, error } = await requirePermission('requests:assign')
  if (error) return error

  const body = await req.json()
  const { message } = body

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message describing required info is mandatory' }, { status: 400 })
  }

  const request = await prisma.adminRequest.findUnique({ where: { id: params.id } })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (['approved', 'rejected'].includes(request.status)) {
    return NextResponse.json(
      { error: `Cannot request info on a ${request.status} request` },
      { status: 422 },
    )
  }

  // Run in transaction: update status + add comment
  const [updated] = await prisma.$transaction([
    prisma.adminRequest.update({
      where: { id: params.id },
      data: { status: 'waiting_for_info' },
    }),
    prisma.comment.create({
      data: {
        requestId: params.id,
        authorId: session.user.id,
        text: `📋 **Запрос дополнительной информации**\n\n${message.trim()}`,
        isInternal: false, // visible to the requester
      },
    }),
  ])

  await logAudit({
    entityType: 'request',
    entityId: params.id,
    action: 'request.info_requested',
    performedBy: session.user.id,
    diff: { before: { status: request.status }, after: { status: 'waiting_for_info' } },
  })

  // TODO: trigger email notification via Resend
  // await sendEmail({ to: request.user?.email, template: 'info-requested', data: { message } })

  return NextResponse.json({ data: updated, message: 'Status updated to waiting_for_info' })
}
