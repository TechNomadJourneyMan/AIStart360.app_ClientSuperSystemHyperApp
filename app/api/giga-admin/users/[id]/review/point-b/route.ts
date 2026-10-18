export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { authorNames } from '@/lib/expert-review/server'
import { POINT_B_VERSION_COLUMNS } from '@/lib/expert-review/point-b'
import { profanityResponse } from '@/lib/moderation/http'
import { legacyShape } from '@/lib/point-b/plan/flow'
import { guarded, guardPlanRoute, saveLegacyNotes } from '@/lib/point-b/plan/route-guard'
import { loadPlanBundle } from '@/lib/point-b/plan/store'

/**
 * GET  /api/giga-admin/users/:id/review/point-b — версии экспертной Точки Б клиента
 *      (версии ПЛАНА в прежнем формате, новые сверху; пока плана нет — прежние строки
 *      point_b_versions) и может ли текущий сотрудник их одобрять.
 * POST /api/giga-admin/users/:id/review/point-b { expert_notes, change_reason? } —
 *      сохранить экспертную версию: это версия плана, сразу «на одобрении». Клиент её
 *      не видит, пока Admin / Super Admin не одобрит (POST …/point-b/approve или
 *      …/point-b/plan/versions/:versionId/approve). point_b_versions больше не пишется.
 *
 * `author_name` — отображаемое имя (ФИО или «Эксперт AIStart360»), не email.
 */

const bodySchema = z.object({
  expert_notes: z.string().trim().min(1, 'Заметки эксперта пустые').max(8000, 'Не больше 8000 символов'),
  change_reason: z.string().trim().max(1000, 'Не больше 1000 символов').nullable().optional(),
})

async function currentDiagId(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await sb
    .from('diagnostics')
    .select('id')
    .eq('user_id', userId)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/review/point-b GET', async () => {
    const g = await guardPlanRoute(req, params.id)
    if (!g.ok) return g.response
    const { ctx } = g
    const { sb, canApprove } = ctx
    const diagId = await currentDiagId(sb, params.id)

    const planVersions = ctx.company ? (await loadPlanBundle(sb, ctx.company.id)).versions.slice(0, 20) : []
    if (planVersions.length) {
      const names = await authorNames(sb, planVersions.map((v) => v.approved_by))
      return NextResponse.json({
        ok: true,
        data: {
          diagnosticId: diagId,
          canApprove,
          versions: planVersions.map((v) => ({ ...legacyShape(v), approved_by_name: v.approved_by ? names.get(v.approved_by) ?? null : null })),
        },
      })
    }

    // No plan yet: the legacy rows (read-only history).
    if (!diagId) return NextResponse.json({ ok: true, data: { diagnosticId: null, versions: [], canApprove } })
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
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/review/point-b POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true })
    if (!g.ok) return g.response

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
    }
    const profane = profanityResponse({ expert_notes: parsed.data.expert_notes, change_reason: parsed.data.change_reason })
    if (profane) return profane

    return saveLegacyNotes(req, g.ctx, { notes: parsed.data.expert_notes, changeReason: parsed.data.change_reason })
  })
}
