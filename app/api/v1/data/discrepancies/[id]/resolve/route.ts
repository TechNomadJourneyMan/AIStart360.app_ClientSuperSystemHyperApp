// ============================================================
// POST /api/v1/data/discrepancies/[id]/resolve[?companyId=]
//
// Body: { choice: 'candidate', index, note? } | { choice: 'custom', value, note? }
//     | { choice: 'ignore', note? }
//
// The owner (manage access) or an expert / staff decides a data discrepancy
// (lib/data-layer/resolve.ts). Identity and company come from the session;
// the write goes through the service role after the tenant check. The company
// data is re-materialised in the background, the decision is audited and
// DISCREPANCY_RESOLVED is emitted.
// ============================================================
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { resolveDiscrepancy } from '@/lib/data-layer/resolve'
import { refreshCompanyDataInBackground } from '@/lib/data-layer/refresh'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import { logAudit } from '@/lib/audit'
import { runInBackground } from '@/lib/background'

export const dynamic = 'force-dynamic'

const Note = z.string().trim().max(1000).optional()
const Body = z.discriminatedUnion('choice', [
  z.object({
    choice: z.literal('candidate'), index: z.number().int().min(0).max(50), note: Note,
    // What the owner saw: a candidate list refreshed meanwhile → 409, not a wrong value.
    expected: z.object({ sourceRef: z.string().max(300), value: z.number().finite() }).optional(),
  }),
  z.object({ choice: z.literal('custom'), value: z.number().finite(), note: Note }),
  z.object({ choice: z.literal('ignore'), note: Note }),
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ERRORS: Record<string, string> = {
  not_found: 'Расхождение не найдено',
  already_closed: 'Расхождение уже закрыто',
  stale_candidates: 'Данные обновились — обновите страницу и выберите ещё раз',
  bad_candidate: 'Неверный вариант',
  invalid_value_needs_custom: 'Это значение вне допустимого диапазона — введите корректное',
  bad_value: 'Неверное значение',
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  if (!UUID.test(params.id)) return apiError(ERRORS.not_found, 404)

  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: 'manage' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  const { companyId, role } = tenant.tenant

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('Неверный запрос', 400)

  const expert = role === 'staff' || role === 'partner_expert' || role === 'partner_admin'
  const out = await resolveDiscrepancy(createServiceClient(), companyId, params.id, parsed.data, { userId: user.id, expert })
  if (!out.ok) {
    if (out.status === 500) console.error('[api/v1/data/discrepancies/resolve]', out.error)
    return apiError(ERRORS[out.error] ?? 'Не удалось сохранить решение', out.status)
  }

  void runInBackground('discrepancy-audit', () =>
    logAudit({
      entityType: 'company',
      entityId: companyId,
      action: 'data.discrepancy_resolved',
      performedBy: user.id,
      diff: { discrepancy_id: params.id, choice: parsed.data.choice, status: out.status, value: out.value, overrides: out.overrides, role },
    }),
  )
  emitPlatformEventSafely({
    name: 'DISCREPANCY_RESOLVED', companyId, subjectType: 'discrepancy', subjectId: params.id, actor: `user:${user.id}`,
    payload: { status: out.status, value: out.value, overrides: out.overrides }, dedupeKey: `discrepancy_resolved:${params.id}`,
  })
  refreshCompanyDataInBackground(companyId)

  return NextResponse.json({ ok: true, data: { status: out.status, value: out.value, overrides: out.overrides } })
}
