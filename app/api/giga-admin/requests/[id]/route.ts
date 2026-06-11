export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * PATCH /api/giga-admin/requests/:id
 * Actions: approve | reject | archive
 * Uses Supabase directly. Hardened: tries multiple paths to update profile status.
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
    let userId: string | null = null

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

    if (arRow) {
      const payload = (arRow.payload as Record<string, string>) ?? {}
      userId = payload.userId ?? null
    }

    // Fallback: params.id might itself be a profile UUID (orphaned profile entry)
    if (!userId) {
      userId = params.id
    }

    // 2. ALWAYS sync profile status — hardened with dual attempt
    if (body.action === 'approve' || body.action === 'reject') {
      const profileStatus = body.action === 'approve' ? 'approved' : 'rejected'

      // Attempt 1: use resolved userId
      if (userId) {
        await sb
          .from('profiles')
          .update({
            status: profileStatus,
            ...(body.action === 'approve' ? { approved_at: new Date().toISOString() } : {}),
          })
          .eq('id', userId)
      }

      // Attempt 2: also try params.id directly if different from userId
      if (userId !== params.id) {
        await sb
          .from('profiles')
          .update({
            status: profileStatus,
            ...(body.action === 'approve' ? { approved_at: new Date().toISOString() } : {}),
          })
          .eq('id', params.id)
      }
    }

    return NextResponse.json({ ok: true, status: newStatus })
  } catch (error) {
    console.error('[giga-admin/requests/:id] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
