export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { mayActOnUser } from '@/lib/api-identity'
import { logAudit } from '@/lib/audit'
import { dbError } from '@/lib/api-error'

/**
 * PATCH /api/v1/action-plan/:id
 * Body: { status?, owner?, due_date? }
 * Owner edits own tasks; another client's — only staff / an active expert per
 * migration 140 who passed the step-up of this session and whose client scope
 * covers the task's owner (mayActOnUser: an expert — the assigned clients,
 * staff — by their client scope) (§19). The write goes through the service
 * role, so this check is the only gate.
 */

const STATUSES = new Set(['open', 'in_progress', 'done'])

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

  const admin = createServiceClient()
  const { data: item, error: readError } = await admin.from('action_items').select('user_id').eq('id', params.id).maybeSingle()
  if (readError) return dbError('v1/action-plan/[id]', readError)
  if (!item) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  const isOwner = item.user_id === user.id
  const isStaff = !isOwner
  if (isStaff && !(await mayActOnUser(sb, user.id, item.user_id as string))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { error } = await admin.from('action_items').update(patch).eq('id', params.id)
  if (error) return dbError('v1/action-plan/[id]', error)

  // Audit expert edits of a client's plan.
  if (isStaff) {
    logAudit({
      entityType: 'user', entityId: item.user_id as string, action: 'expert.action_item_updated',
      performedBy: user.id, diff: patch, ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
  }

  return NextResponse.json({ ok: true })
}
