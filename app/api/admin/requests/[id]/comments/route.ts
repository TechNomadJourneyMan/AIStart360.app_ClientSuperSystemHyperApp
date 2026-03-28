export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

type RouteParams = { params: { id: string } }

// ─── GET /api/admin/requests/:id/comments ─────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error } = await requirePermission('requests:read')
  if (error) return error

  const comments = await prisma.comment.findMany({
    where: { requestId: params.id },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ data: comments })
}

// ─── POST /api/admin/requests/:id/comments ────────────────────────────────────

/**
 * Add a comment to a request.
 * Body: { text: string, isInternal?: boolean }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('comments:write')
  if (error) return error

  const body = await req.json()
  const { text, isInternal = true } = body

  if (!text?.trim()) {
    return NextResponse.json({ error: 'Comment text is required' }, { status: 400 })
  }

  const request = await prisma.adminRequest.findUnique({ where: { id: params.id } })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const comment = await prisma.comment.create({
    data: {
      requestId: params.id,
      authorId: session.user.id,
      text: text.trim(),
      isInternal,
    },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true, role: true } },
    },
  })

  await logAudit({
    entityType: 'request',
    entityId: params.id,
    action: 'request.commented',
    performedBy: session.user.id,
    diff: { after: { commentId: comment.id, isInternal } },
  })

  return NextResponse.json({ data: comment }, { status: 201 })
}
