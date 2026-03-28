export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

type RouteParams = { params: { id: string } }

// ─── GET /api/admin/companies/:id ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { error } = await requirePermission('companies:read')
  if (error) return error

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    include: {
      requests: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignedAdmin: { select: { id: true, name: true } },
        },
      },
      _count: { select: { requests: true } },
    },
  })

  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: company })
}

// ─── PATCH /api/admin/companies/:id ──────────────────────────────────────────

/**
 * Update company status, name, domain, or notes.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission('companies:write')
  if (error) return error

  const body = await req.json()
  const { name, domain, status, notes } = body

  const before = await prisma.company.findUnique({ where: { id: params.id } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.company.update({
    where: { id: params.id },
    data: {
      ...(name && { name }),
      ...(domain !== undefined && { domain }),
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
    },
  })

  await logAudit({
    entityType: 'company',
    entityId: params.id,
    action: 'company.status_changed',
    performedBy: session.user.id,
    diff: { before: { status: before.status }, after: { status } },
  })

  return NextResponse.json({ data: updated })
}
