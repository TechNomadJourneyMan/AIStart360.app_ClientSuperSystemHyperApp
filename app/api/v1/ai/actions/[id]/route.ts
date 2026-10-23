// ============================================================
// POST /api/v1/ai/actions/[id]  { decision: 'apply' | 'reject' }
//
// A change the AI chat proposed (ai_pending_actions, migration 116) — decided
// by the user who received it. Applying re-checks: the action is the caller's,
// pending, not expired, and the caller manages its company NOW
// (lib/chat/actions.ts). Applied → audit + the event that recalculates Point A.
// ============================================================
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { decideAction, loadPending } from '@/lib/chat/actions'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import { isPlatformEventName } from '@/lib/events/platform-names'
import { logAudit } from '@/lib/audit'
import { runInBackground } from '@/lib/background'
import { applySurveyAction } from '@/lib/survey/chat/apply'
import { activeImpersonation } from '@/lib/impersonation/server'
import { trackEvent } from '@/lib/events/track'

export const dynamic = 'force-dynamic'

// edited_value: «Исправить» on a questionnaire card — the value the client typed (checked by the field schema).
const Body = z.object({ decision: z.enum(['apply', 'reject']), edited_value: z.unknown().optional() })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ERRORS: Record<string, string> = {
  already_decided: 'Это действие уже выполнено или отменено',
  expired: 'Предложение устарело — попросите AI подготовить его заново',
  forbidden: 'Изменять данные компании может владелец или администратор',
  bad_value: 'Значение вне допустимого диапазона',
  stale_candidates: 'Данные изменились — попросите AI подготовить решение заново',
  already_closed: 'Расхождение уже закрыто',
  profanity: 'В ответе есть грубые слова — переформулируйте, пожалуйста',
  apply_failed: 'Не удалось записать — попробуйте ещё раз',
}
const SURVEY_ERRORS: Record<string, string> = {
  expired: 'Предложение устарело — ответьте ещё раз',
  bad_value: 'Такое значение анкета не примет — проверьте ответ',
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  if (!UUID.test(params.id)) return apiError('Действие не найдено', 404)
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('Неверный запрос', 400)

  const service = createServiceClient()
  const row = await loadPending(service, params.id, user.id)
  if (!row) return apiError('Действие не найдено', 404)

  // A questionnaire chat card (survey Ф4): the answers are the user's own — no
  // company rights; the only way the chat writes survey_answers.
  if (row.kind === 'set_survey_answer') {
    if (await activeImpersonation(user.id)) return apiError('В режиме «от имени» записывать ответы за клиента из беседы нельзя', 403)
    const out = await applySurveyAction(service, row, parsed.data.decision, {
      userId: user.id,
      ...(parsed.data.edited_value !== undefined ? { editedValue: parsed.data.edited_value } : {}),
    })
    if (!out.ok) return apiError(SURVEY_ERRORS[out.error] ?? ERRORS[out.error] ?? 'Не удалось выполнить действие', out.status)
    const outcome = out.status === 'applied' ? (out.edited ? 'edited' : 'applied') : 'rejected'
    void trackEvent({ userId: user.id, name: 'SURVEY_CHAT_PROPOSAL', entityType: 'survey', entityId: user.id, metadata: { key: out.key, outcome }, source: 'server' })
    if (out.status === 'applied' && out.companyId) {
      // The data Point A is built from changed (one event per minute, like an explicit save).
      emitPlatformEventSafely({
        name: 'SURVEY_ANSWER_CHANGED', companyId: out.companyId, subjectType: 'survey', subjectId: user.id, actor: `user:${user.id}`,
        payload: { keys: [out.key], via: 'chat' }, dedupeKey: `survey_changed:${out.companyId}:${new Date().toISOString().slice(0, 16)}`,
      })
    }
    return NextResponse.json({ ok: true, data: { status: out.status, ...(out.status === 'applied' ? { attribution: out.attribution } : {}) } })
  }

  const tenant = await resolveTenantWith(sb, user.id, { companyId: row.company_id, access: parsed.data.decision === 'apply' ? 'manage' : 'read' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  const role = tenant.tenant.role
  const out = await decideAction(service, row, parsed.data.decision, {
    userId: user.id, canManage: tenant.tenant.canManage, expert: role === 'staff' || role === 'partner_expert' || role === 'partner_admin',
  })
  if (!out.ok) return apiError(ERRORS[out.error] ?? 'Не удалось выполнить действие', out.status)

  if (out.status === 'applied') {
    if (out.event && isPlatformEventName(out.event)) {
      emitPlatformEventSafely({ name: out.event, companyId: out.companyId, subjectType: 'ai_action', subjectId: params.id, actor: `user:${user.id}`, payload: { kind: out.kind, via: 'ai_chat' }, dedupeKey: `ai_action:${params.id}` })
    }
    void runInBackground('ai-action-audit', () => logAudit({ entityType: 'company', entityId: out.companyId, action: 'ai_chat.action_applied', performedBy: user.id, diff: { action_id: params.id, kind: out.kind, via: 'ai_chat' } }))
  }
  return NextResponse.json({ ok: true, data: { status: out.status } })
}
