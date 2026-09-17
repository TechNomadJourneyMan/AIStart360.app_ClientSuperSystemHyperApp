export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga, staffRoleOfUser } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { canManageTarget } from '@/lib/admin/rbac'
import { recordAdminAction } from '@/lib/admin/audit'

// DELETE /api/giga-admin/users/:id/gri/draft { reason } — reset an unfinished test.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['gri.edit', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const reason = String(((await req.json().catch(() => null)) as { reason?: string } | null)?.reason ?? '').trim()
  if (reason.length < 3) return NextResponse.json({ ok: false, error: 'Укажите причину' }, { status: 400 })
  const target = await staffRoleOfUser(params.id)
  if (!canManageTarget(guard.actor.role, target.staffRole)) return NextResponse.json({ ok: false, error: 'Недостаточно прав' }, { status: 403 })
  const sb = createServiceClient()
  const { data: draft } = await sb.from('gri_assessment_drafts').select('state, updated_at').eq('user_id', params.id).maybeSingle()
  if (!draft) return NextResponse.json({ ok: true, alreadyEmpty: true })
  await recordAdminAction(guard.actor, {
    action: 'gri.draft_deleted', entityType: 'gri_draft', entityId: params.id, targetUserId: params.id,
    oldValue: draft, newValue: null, metadata: { reason },
  }, req, { required: true })
  const { error } = await sb.from('gri_assessment_drafts').delete().eq('user_id', params.id)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить черновик' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
