export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 *
 * On approve/reject, also updates public.profiles.status in Supabase
 * so the client waiting-room detects the change.
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
    // 1. Update AdminRequest in Prisma
    const updated = await prisma.adminRequest.update({
      where: { id: params.id },
      data: {
        status: statusMap[body.action],
        ...(body.action === 'reject' && body.reason
          ? { rejectionReason: body.reason }
          : {}),
      },
    })

    // 2. Sync status to public.profiles in Supabase (for waiting-room)
    if (body.action === 'approve' || body.action === 'reject') {
      const request = await prisma.adminRequest.findUnique({ where: { id: params.id } })
      const payload = (request?.payload ?? {}) as Record<string, string>
      const supabaseUserId = payload.userId

      if (supabaseUserId) {
        const supabaseAdmin = createServerClient()
        const profileStatus = body.action === 'approve' ? 'approved' : 'rejected'

        await supabaseAdmin
          .from('profiles')
          .update({
            status: profileStatus,
            ...(body.action === 'approve' ? { approved_at: new Date().toISOString() } : {}),
          })
          .eq('id', supabaseUserId)
      }
    }

    return NextResponse.json({ ok: true, status: updated.status })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
