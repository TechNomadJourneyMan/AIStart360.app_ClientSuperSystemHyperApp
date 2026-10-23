export const dynamic = 'force-dynamic'

// GET   /api/expert/clients/[id]/survey — the client's questionnaire for the
//       expert cabinet: answers, who filled each one and how (author + path),
//       the client's name, the latest changes, and whether the viewer may edit.
// PATCH /api/expert/clients/[id]/survey { changes: {key: value}, reason }
//       PO decision 2026-10-23 (spec §18.3 item 3): an expert edits the answers
//       of HIS (assigned) clients; admin / super_admin — any client. The write
//       goes through adminEditSurvey (mandatory audit with the reason, author
//       «эксперт», path «staff», survey_answer_history by trigger), the goal
//       follows a step-1 goal answer, the client gets a notice.
// Access: resolveExpert (approved expert / admin / super_admin + second
// factor) and guardExpertClient (assignment via user_assignments).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { expertBlockResponse, guardExpertClient, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { adminEditSurvey, SurveyEditError } from '@/lib/admin/survey-admin'
import { answersProfanityResponse } from '@/lib/moderation/http'
import { isWizardVisibleKey } from '@/lib/survey/steps'
import { fromAnswerEnvelope, toAnswerEnvelope } from '@/lib/survey/answer-value'
import { loadAttribution, type AttributionSourceRow } from '@/lib/survey/attribution-read'
import { syncGoalsAfterWrite } from '@/lib/survey/write'
import { notifyClientOfExpertEdit } from '@/lib/survey/expert-edit'
import { isRateLimitedKey } from '@/lib/rate-limit'

const HISTORY_LIMIT = 30

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied

  const sb = createServiceClient()
  const [answersRes, profileRes, historyRes] = await Promise.all([
    // '*': the author (131) and path (134) columns are read when present.
    sb.from('survey_answers').select('*').eq('user_id', params.id),
    sb.from('profiles').select('full_name, email').eq('id', params.id).maybeSingle(),
    sb.from('survey_answer_history')
      .select('id, question_key, operation, old_value, new_value, changed_by, source, updated_at, revisions')
      .eq('user_id', params.id)
      .order('updated_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ])
  if (answersRes.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить анкету' }, { status: 500 })

  const rows = ((answersRes.data ?? []) as AttributionSourceRow[]).filter((r) => isWizardVisibleKey(String(r.question_key)))
  const answers: Record<string, unknown> = {}
  const answeredAt: Record<string, string> = {}
  for (const r of rows) {
    answers[r.question_key] = fromAnswerEnvelope(r.answer)
    if (r.answered_at) answeredAt[r.question_key] = String(r.answered_at)
  }
  const attribution = await loadAttribution(sb, rows)
  const profile = profileRes.data as { full_name?: string | null; email?: string | null } | null
  const ownerName = profile?.full_name?.trim() || profile?.email || null

  return NextResponse.json({
    ok: true,
    data: {
      answers,
      answeredAt,
      attribution,
      ownerName,
      viewerId: auth.viewer.id,
      canEdit: true,
      history: (historyRes.data ?? []).map((h) => ({
        ...h,
        old_value: fromAnswerEnvelope(h.old_value) ?? null,
        new_value: fromAnswerEnvelope(h.new_value) ?? null,
      })),
    },
  })
}

const patchSchema = z.object({
  changes: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), z.unknown())
    .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 50, 'от 1 до 50 полей за раз'),
  reason: z.string().trim().min(3, 'Укажите причину изменения').max(300),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный формат изменений' }, { status: 400 })
  }
  const { changes, reason } = parsed.data
  // Experts change answers; removing an answer stays with the GIGA staff (survey.edit / survey.delete).
  if (Object.values(changes).some((v) => v === null || v === undefined)) {
    return NextResponse.json({ ok: false, error: 'Удалить ответ может только администратор. Укажите новое значение или «Не знаю».' }, { status: 400 })
  }
  const profane = answersProfanityResponse(changes)
  if (profane) return profane
  if (await isRateLimitedKey(auth.viewer.id, 'expert-survey-edit', { max: 60, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много изменений. Попробуйте через минуту.' }, { status: 429 })
  }

  const isAdmin = auth.viewer.role === 'admin' || auth.viewer.role === 'super_admin'
  try {
    const result = await adminEditSurvey(
      { id: auth.viewer.id, kind: 'session', email: auth.viewer.email ?? undefined },
      params.id,
      changes,
      req,
      { reason, authorRole: isAdmin ? 'admin' : 'expert', auditAction: 'expert.survey_edited' },
    )
    if (result.updated + result.deleted > 0) {
      const service = createServiceClient()
      const keys = Object.keys(changes).filter((k) => !result.ignored.includes(k))
      await syncGoalsAfterWrite(service, {
        ownerId: params.id,
        rows: keys.map((k) => ({ question_key: k, answer: toAnswerEnvelope(changes[k]) })),
        actor: { id: auth.viewer.id, role: isAdmin ? 'admin' : 'expert' },
        allowClear: true,
      })
      const { data: me } = await service.from('profiles').select('full_name, email').eq('id', auth.viewer.id).maybeSingle()
      const meRow = me as { full_name?: string | null; email?: string | null } | null
      await notifyClientOfExpertEdit({
        clientId: params.id,
        expertId: auth.viewer.id,
        expertName: meRow?.full_name?.trim() || meRow?.email || null,
        keys,
        reason,
      })
    }
    return NextResponse.json({ ok: true, data: result })
  } catch (e) {
    if (e instanceof SurveyEditError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
    const msg = e instanceof Error ? e.message : 'Ошибка сохранения'
    return NextResponse.json({ ok: false, error: msg.startsWith('Audit') ? 'Журнал аудита недоступен — изменение не сохранено' : 'Не удалось сохранить анкету' }, { status: msg.startsWith('Audit') ? 503 : 500 })
  }
}
