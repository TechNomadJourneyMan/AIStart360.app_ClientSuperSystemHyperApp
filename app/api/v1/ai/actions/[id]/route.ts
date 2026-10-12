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

export const dynamic = 'force-dynamic'

const Body = z.object({ decision: z.enum(['apply', 'reject']) })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ERRORS: Record<string, string> = {
  already_decided: 'Это действие уже выполнено или отменено',
  expired: 'Предложение устарело — попросите AI подготовить его заново',
  forbidden: 'Изменять данные компании может владелец или администратор',
  bad_value: 'Значение вне допустимого диапазона',
  stale_candidates: 'Данные изменились — попросите AI подготовить решение заново',
  already_closed: 'Расхождение уже закрыто',
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
