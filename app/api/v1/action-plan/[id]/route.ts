export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createClient as createSr } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

/**
 * PATCH /api/v1/action-plan/:id
 * Body: { status?, owner?, due_date? }
 * Owner edits own tasks; staff (expert/admin) edits any client's (§19).
 */

const STAFF = new Set(['expert', 'admin', 'super_admin'])
const STATUSES = new Set(['open', 'in_progress', 'done'])

function sr() {
  return createSr(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { status?: string; owner?: string | null; due_date?: string | null } | null
  if (!body) return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return NextResponse.json({ ok: false, error: 'invalid status' }, { status: 400 })
    patch.status = body.status
  }
  if (body.owner !== undefined) patch.owner = body.owner
  if (body.due_date !== undefined) patch.due_date = body.due_date
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'no fields' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  const admin = sr()
  const { data: item } = await admin.from('action_items').select('user_id').eq('id', params.id).maybeSingle()
  if (!item) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  const isOwner = item.user_id === user.id
  let isStaff = false
  if (!isOwner) {
    const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
    isStaff = STAFF.has((prof?.role as string) ?? '')
    if (!isStaff) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { error } = await admin.from('action_items').update(patch).eq('id', params.id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Audit expert edits of a client's plan.
  if (isStaff) {
    logAudit({
      entityType: 'user', entityId: item.user_id as string, action: 'expert.action_item_updated',
      performedBy: user.id, diff: patch, ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
  }

  return NextResponse.json({ ok: true })
}
