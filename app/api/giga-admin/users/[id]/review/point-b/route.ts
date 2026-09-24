export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { UUID_RE, authorNames, displayNameOf } from '@/lib/expert-review/server'
import { POINT_B_VERSION_COLUMNS, canApprovePointB } from '@/lib/expert-review/point-b'

/**
 * GET  /api/giga-admin/users/:id/review/point-b — версии экспертной Точки Б
 *      по текущей диагностике клиента (новые сверху) и может ли текущий
 *      сотрудник их одобрять.
 * POST /api/giga-admin/users/:id/review/point-b { expert_notes, roadmap? } —
 *      сохранить экспертную версию. Она НЕ одобрена: клиент её не видит, пока
 *      Admin / Super Admin не одобрит (POST …/point-b/approve).
 *
 * `author_name` — отображаемое имя (ФИО или «Эксперт AIStart360»), не email.
 */

const bodySchema = z.object({
  expert_notes: z.string().trim().min(1, 'Заметки эксперта пустые').max(8000, 'Не больше 8000 символов'),
  roadmap: z.unknown().optional(),
})

async function currentDiagId(userId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from('diagnostics')
    .select('id')
    .eq('user_id', userId)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const canApprove = canApprovePointB(guard.actor.role)
  const diagId = await currentDiagId(params.id)
  if (!diagId) return NextResponse.json({ ok: true, data: { diagnosticId: null, versions: [], canApprove } })

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('point_b_versions')
    .select(POINT_B_VERSION_COLUMNS)
    .eq('diagnostic_id', diagId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ ok: true, data: { diagnosticId: diagId, versions: [], canApprove }, unavailable: true })

  const rows = (data as Array<{ approved_by: string | null } & Record<string, unknown>> | null) ?? []
  const names = await authorNames(sb, rows.map((r) => r.approved_by))
  return NextResponse.json({
    ok: true,
    data: {
      diagnosticId: diagId,
      canApprove,
      versions: rows.map((r) => ({ ...r, approved_by_name: r.approved_by ? names.get(r.approved_by) ?? null : null })),
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }

  const diagId = await currentDiagId(params.id)
  if (!diagId) return NextResponse.json({ ok: false, error: 'У клиента нет текущей диагностики (Точки А)' }, { status: 400 })

  const sb = createServiceClient()
  const authorName = await displayNameOf(sb, guard.actor.id)
  const { data, error } = await sb
    .from('point_b_versions')
    .insert({
      diagnostic_id: diagId,
      authored_by: guard.actor.id,
      author_name: authorName,
      expert_notes: parsed.data.expert_notes,
      roadmap: parsed.data.roadmap ?? null,
      is_approved: false,
    })
    .select(POINT_B_VERSION_COLUMNS)
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить версию Точки Б' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'expert.point_b_version_created', entityType: 'point_b_version', entityId: (data as { id: string }).id, targetUserId: params.id,
    metadata: { diagnosticId: diagId, preview: parsed.data.expert_notes.slice(0, 120), approved: false },
  }, req)

  return NextResponse.json({ ok: true, data })
}
