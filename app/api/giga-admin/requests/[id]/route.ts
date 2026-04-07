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
    const { data: sbRow, error: sbErr } = await supabaseAdmin
      .from('admin_requests')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
        ...(body.action === 'reject' && body.reason ? { rejection_reason: body.reason } : {}),
      })
      .eq('id', params.id)
      .select('*')
      .single()

    if (sbErr) {
      console.warn('[giga-admin/requests/:id] admin_requests update error:', sbErr.message)
    }

    if (sbRow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = sbRow as any
      const payload = (row.payload ?? {}) as Record<string, string>
      // Try payload.userId first, then any direct user_id column on the row
      supabaseUserId = payload.userId || row.user_id || null
      console.log('[giga-admin/requests/:id] sbRow payload.userId:', payload.userId, 'row.user_id:', row.user_id)
    }

    // Fallback: params.id might itself be the Supabase user UUID (orphaned profile entry)
    if (!supabaseUserId) {
      supabaseUserId = params.id
      console.log('[giga-admin/requests/:id] falling back to params.id as supabaseUserId:', params.id)
    }
  }

  // 2. ALWAYS sync profile status to Supabase so waiting-room reflects the decision
  if (body.action === 'approve' || body.action === 'reject') {
    const profileStatus = body.action === 'approve' ? 'approved' : 'rejected'

    // Attempt 1: use resolved supabaseUserId (from payload.userId or params.id)
    if (supabaseUserId) {
      const { data: updated1, error: err1 } = await supabaseAdmin
        .from('profiles')
        .update({ status: profileStatus })
        .eq('id', supabaseUserId)
        .select('id')

      if (err1) {
        console.error('[giga-admin/requests/:id] profile update error (attempt 1):', err1)
      } else {
        console.log('[giga-admin/requests/:id] profile update attempt 1 rows:', updated1?.length ?? 0)
      }

      // Attempt 2: if supabaseUserId differed from params.id, also try params.id directly
      // (covers the case where supabaseUserId was an admin_requests UUID, not a user UUID)
      if (supabaseUserId !== params.id) {
        const { data: updated2, error: err2 } = await supabaseAdmin
          .from('profiles')
          .update({ status: profileStatus })
          .eq('id', params.id)
          .select('id')

        if (!err2 && updated2 && updated2.length > 0) {
          console.log('[giga-admin/requests/:id] profile updated via params.id fallback')
        }
      }
    }
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
