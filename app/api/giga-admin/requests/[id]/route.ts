export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 * Works with both admin_requests table and profiles table in Supabase.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { action: 'approve' | 'reject' | 'archive'; reason?: string }
  const sb = createServerClient()
  const newStatus = { approve: 'approved', reject: 'rejected', archive: 'archived' }[body.action]

  try {
    // 1. Try updating admin_requests table
    const { data: arRow } = await sb
      .from('admin_requests')
      .update({
        status: newStatus,
        ...(body.action === 'reject' && body.reason ? { rejection_reason: body.reason } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select('payload')
      .maybeSingle()

    // Extract userId — from admin_requests payload or from profiles directly
    let userId: string | null = null
    if (arRow) {
      userId = (arRow.payload as Record<string, string>)?.userId ?? null
    } else {
      // The id might be a profile id directly (orphaned profile shown as request)
      userId = params.id
    }

    // 2. Update profile status in Supabase
    if (userId && (body.action === 'approve' || body.action === 'reject')) {
      const profileStatus = body.action === 'approve' ? 'approved' : 'rejected'
      await sb
        .from('profiles')
        .update({
          status: profileStatus,
          ...(body.action === 'approve' ? { approved_at: new Date().toISOString() } : {}),
        })
        .eq('id', userId)
    }

    return NextResponse.json({ ok: true, status: newStatus })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
