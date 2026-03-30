export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { action: 'approve' | 'reject' | 'archive'; reason?: string }

  const statusMap = {
    approve: 'approved',
    reject: 'rejected',
    archive: 'archived',
  } as const

  try {
    const updated = await prisma.adminRequest.update({
      where: { id: params.id },
      data: {
        status: statusMap[body.action],
        ...(body.action === 'reject' && body.reason
          ? { rejectionReason: body.reason }
          : {}),
      },
    })
    return NextResponse.json({ ok: true, status: updated.status })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
