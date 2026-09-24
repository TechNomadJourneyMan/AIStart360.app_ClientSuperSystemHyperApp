export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga, staffRoleOfUser, type GigaActor } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { canManageTarget } from '@/lib/admin/rbac'
import { recordAdminAction } from '@/lib/admin/audit'
import { computeGriIndex, computeSectionAvgs, type GriScores } from '@/lib/gri-assessment/score'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { computeTop5Limits, generate90DayPlan } from '@/lib/gri-calculator/top5-action-plan'
import { guardClientAccess } from '@/lib/admin/client-scope'

// PATCH  /api/giga-admin/users/:id/gri/:assessmentId { scores?, makeCurrent?, reason }
//        — correct answers (index, blocks, TOP-5 and plan are recomputed with the
//        same code as the user flow) or make an older assessment the current one.
// DELETE /api/giga-admin/users/:id/gri/:assessmentId { reason } — remove a result.
// Both are audited with the full old → new values before the change.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_SECTIONS = new Set(GRI_SECTIONS.map((s) => s.id))
const VALID_CRITERIA = new Map(GRI_SECTIONS.map((s) => [s.id as string, new Set(s.criteria.map((c) => c.id))]))

const patchSchema = z.object({
  scores: z.record(z.string(), z.record(z.string(), z.number().int().min(0).max(10))).optional(),
  makeCurrent: z.boolean().optional(),
  reason: z.string().trim().min(3, 'Укажите причину').max(300),
})

interface AssessmentRow {
  id: string; user_id: string; gri_index: number | string; section_avgs: Record<string, number> | null
  scores: GriScores | null; top_5_limits: unknown; action_plan_90d: unknown; is_current: boolean; created_at: string
}
type Loaded =
  | { response: NextResponse }
  | { actor: GigaActor; sb: ReturnType<typeof createServiceClient>; row: AssessmentRow }

async function load(req: NextRequest, params: { id: string; assessmentId: string }, permission: 'gri.edit' | 'gri.delete'): Promise<Loaded> {
  const guard = await requireGiga(req, [permission, 'users.sensitive'])
  if (guard.response) return { response: guard.response }
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return { response: scopeDenied }
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.assessmentId)) {
    return { response: NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 }) }
  }
  const target = await staffRoleOfUser(params.id)
  if (!canManageTarget(guard.actor.role, target.staffRole)) {
    return { response: NextResponse.json({ ok: false, error: 'Недостаточно прав для этого пользователя' }, { status: 403 }) }
  }
  const sb = createServiceClient()
  const { data: row } = await sb
    .from('gri_assessments')
    .select('id, user_id, gri_index, section_avgs, scores, top_5_limits, action_plan_90d, is_current, created_at')
    .eq('id', params.assessmentId)
    .eq('user_id', params.id)
    .maybeSingle()
  if (!row) return { response: NextResponse.json({ ok: false, error: 'Оценка не найдена' }, { status: 404 }) }
  return { actor: guard.actor, sb, row: row as AssessmentRow }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; assessmentId: string } }) {
  // Authorization first: a caller without the permission learns nothing, not even validation errors.
  const pre = await requireGiga(req, ['gri.edit', 'users.sensitive'])
  if (pre.response) return pre.response
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const ctx = await load(req, params, 'gri.edit')
  if ('response' in ctx) return ctx.response
  const { actor, sb, row } = ctx
  const { scores, makeCurrent, reason } = parsed.data

  if (scores) {
    for (const [sec, crit] of Object.entries(scores)) {
      if (!VALID_SECTIONS.has(sec as never)) return NextResponse.json({ ok: false, error: `Неизвестный блок: ${sec}` }, { status: 400 })
      for (const c of Object.keys(crit)) {
        if (!VALID_CRITERIA.get(sec)?.has(c)) return NextResponse.json({ ok: false, error: `Неизвестный критерий: ${c}` }, { status: 400 })
      }
    }
    // Merge per criterion; 0 clears an answer.
    const merged: GriScores = JSON.parse(JSON.stringify(row.scores ?? {}))
    for (const [sec, crit] of Object.entries(scores)) {
      merged[sec] = { ...(merged[sec] ?? {}) }
      for (const [c, v] of Object.entries(crit)) {
        if (v === 0) delete merged[sec][c]
        else merged[sec][c] = v
      }
    }
    const section_avgs = computeSectionAvgs(merged)
    const gri_index = computeGriIndex(section_avgs)
    const top_5_limits = computeTop5Limits(merged, GRI_SECTIONS)
    const action_plan_90d = generate90DayPlan(top_5_limits, section_avgs)

    await recordAdminAction(actor, {
      action: 'gri.assessment_edited',
      entityType: 'gri_assessment',
      entityId: row.id,
      targetUserId: row.user_id,
      oldValue: { gri_index: Number(row.gri_index), section_avgs: row.section_avgs, scores: row.scores },
      newValue: { gri_index, section_avgs, scores: merged },
      metadata: { reason, changed: scores },
    }, req, { required: true })

    const { error } = await sb
      .from('gri_assessments')
      .update({ scores: merged, section_avgs, gri_index, top_5_limits, action_plan_90d })
      .eq('id', row.id)
    if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить оценку' }, { status: 500 })
  }

  if (makeCurrent && !row.is_current) {
    await recordAdminAction(actor, {
      action: 'gri.assessment_made_current',
      entityType: 'gri_assessment',
      entityId: row.id,
      targetUserId: row.user_id,
      oldValue: { is_current: false },
      newValue: { is_current: true },
      metadata: { reason },
    }, req, { required: true })
    // Unique index allows one current row: clear first, then set.
    const clear = await sb.from('gri_assessments').update({ is_current: false }).eq('user_id', row.user_id).eq('is_current', true)
    if (clear.error) return NextResponse.json({ ok: false, error: 'Не удалось переключить оценку' }, { status: 500 })
    const set = await sb.from('gri_assessments').update({ is_current: true }).eq('id', row.id)
    if (set.error) return NextResponse.json({ ok: false, error: 'Не удалось переключить оценку' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; assessmentId: string } }) {
  const pre = await requireGiga(req, ['gri.delete', 'users.sensitive'])
  if (pre.response) return pre.response
  const body = (await req.json().catch(() => null)) as { reason?: string } | null
  const reason = (body?.reason ?? '').trim()
  if (reason.length < 3) return NextResponse.json({ ok: false, error: 'Укажите причину удаления' }, { status: 400 })
  const ctx = await load(req, params, 'gri.delete')
  if ('response' in ctx) return ctx.response
  const { actor, sb, row } = ctx

  // The full row goes to the append-only journal first: a deleted result can be
  // reconstructed from the audit entry.
  await recordAdminAction(actor, {
    action: 'gri.assessment_deleted',
    entityType: 'gri_assessment',
    entityId: row.id,
    targetUserId: row.user_id,
    oldValue: row,
    newValue: null,
    metadata: { reason },
  }, req, { required: true })

  const { error } = await sb.from('gri_assessments').delete().eq('id', row.id)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить оценку' }, { status: 500 })

  // Keep one current result if others remain.
  if (row.is_current) {
    const { data: latest } = await sb.from('gri_assessments').select('id').eq('user_id', row.user_id).order('created_at', { ascending: false }).limit(1)
    if (latest?.[0]) await sb.from('gri_assessments').update({ is_current: true }).eq('id', latest[0].id)
  }
  return NextResponse.json({ ok: true })
}
