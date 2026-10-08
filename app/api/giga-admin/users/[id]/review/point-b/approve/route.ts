export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { UUID_RE } from '@/lib/expert-review/server'
import { POINT_B_VERSION_COLUMNS, canApprovePointB } from '@/lib/expert-review/point-b'

/**
 * POST /api/giga-admin/users/:id/review/point-b/approve { versionId }
 *
 * Одобрить экспертную версию Точки Б — только Admin / Super Admin (рангом выше
 * SuperExpert). После одобрения клиент видит её в своей Точке Б.
 */

const bodySchema = z.object({ versionId: z.string().regex(UUID_RE, 'invalid versionId') })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!canApprovePointB(guard.actor.role)) {
    return NextResponse.json({ ok: false, error: 'Одобрить Точку Б может только Admin или Super Admin' }, { status: 403 })
  }
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Не указана версия' }, { status: 400 })

  const sb = createServiceClient()
  // Версия должна принадлежать диагностике ЭТОГО клиента.
  const { data: version } = await sb
    .from('point_b_versions')
    .select('id, diagnostic_id, is_approved')
    .eq('id', parsed.data.versionId)
    .maybeSingle()
  const v = version as { id: string; diagnostic_id: string | null; is_approved: boolean } | null
  let owned = false
  if (v?.diagnostic_id) {
    const { data: diag } = await sb.from('diagnostics').select('user_id').eq('id', v.diagnostic_id).maybeSingle()
    owned = (diag as { user_id?: string } | null)?.user_id === params.id
  }
  if (!v || !owned) return NextResponse.json({ ok: false, error: 'Версия не найдена' }, { status: 404 })
  if (v.is_approved) return NextResponse.json({ ok: false, error: 'Версия уже одобрена' }, { status: 409 })

  const now = new Date().toISOString()
  const { data, error } = await sb
    .from('point_b_versions')
    .update({ is_approved: true, approved_by: guard.actor.id, approved_at: now })
    .eq('id', v.id)
    .eq('is_approved', false)
    .select(POINT_B_VERSION_COLUMNS)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось одобрить версию' }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Версия уже одобрена' }, { status: 409 })

  await recordAdminAction(guard.actor, {
    action: 'expert.point_b_approved', entityType: 'point_b_version', entityId: v.id, targetUserId: params.id,
    oldValue: { is_approved: false }, newValue: { is_approved: true, approved_at: now },
  }, req)

  return NextResponse.json({ ok: true, data })
}
