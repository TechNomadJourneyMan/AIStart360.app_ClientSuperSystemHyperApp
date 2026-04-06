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

  const supabaseAdmin = createServerClient()
  const newStatus = statusMap[body.action]
  let supabaseUserId: string | null = null

  // 1. Try Prisma update
  try {
    const updated = await prisma.adminRequest.update({
      where: { id: params.id },
      data: {
        status: newStatus,
        ...(body.action === 'reject' && body.reason ? { rejectionReason: body.reason } : {}),
      },
    })
    const payload = (updated.payload ?? {}) as Record<string, string>
    supabaseUserId = payload.userId ?? null
  } catch (prismaError) {
    console.warn('[giga-admin/requests/:id] Prisma unavailable, using Supabase fallback:', prismaError)

    // Fallback: update admin_requests table in Supabase directly
    const { data: sbRow } = await supabaseAdmin
      .from('admin_requests')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
        ...(body.action === 'reject' && body.reason ? { rejection_reason: body.reason } : {}),
      })
      .eq('id', params.id)
      .select('payload')
      .single()

    if (sbRow) {
      const payload = (sbRow.payload ?? {}) as Record<string, string>
      supabaseUserId = payload.userId ?? null
    } else {
      // Last resort: find userId from profiles by looking up the request id as user id
      supabaseUserId = params.id
    }
  }

  // 2. ALWAYS sync profile status to Supabase so waiting-room reflects the decision
  if ((body.action === 'approve' || body.action === 'reject') && supabaseUserId) {
    const profileStatus = body.action === 'approve' ? 'approved' : 'rejected'
    await supabaseAdmin
      .from('profiles')
      .update({
        status: profileStatus,
        ...(body.action === 'approve' ? { approved_at: new Date().toISOString() } : {}),
      })
      .eq('id', supabaseUserId)
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
