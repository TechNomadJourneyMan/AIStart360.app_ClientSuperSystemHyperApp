export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/client-scope'
import { badRequest, guardPointAExpert } from '@/lib/admin/point-a-expert'
import { resolveDiscrepancy } from '@/lib/data-layer/resolve'
import { refreshCompanyDataInBackground } from '@/lib/data-layer/refresh'
import { emitPlatformEventSafely } from '@/lib/events/platform'

/**
 * POST /api/giga-admin/users/:id/point-a/v4/discrepancies/:discrepancyId
 *   { choice: 'candidate', index, expected?, note? } | { choice: 'custom', value, note? } | { choice: 'ignore', note? }
 *
 * The expert closes a data discrepancy of the client's company (same rules as
 * the client's /api/v1/data/discrepancies/:id/resolve, decided as expert:
 * status resolved_expert). The company data is re-materialised and
 * DISCREPANCY_RESOLVED recalculates Point A.
 */

const Note = z.string().trim().max(1000).optional()
const Body = z.discriminatedUnion('choice', [
  z.object({
    choice: z.literal('candidate'), index: z.number().int().min(0).max(50), note: Note,
    expected: z.object({ sourceRef: z.string().max(300), value: z.number().finite() }).optional(),
  }),
  z.object({ choice: z.literal('custom'), value: z.number().finite(), note: Note }),
  z.object({ choice: z.literal('ignore'), note: Note }),
])

const ERRORS: Record<string, string> = {
  not_found: 'Расхождение не найдено',
  already_closed: 'Расхождение уже закрыто',
  stale_candidates: 'Данные обновились — обновите вкладку и выберите ещё раз',
  bad_candidate: 'Неверный вариант',
  invalid_value_needs_custom: 'Это значение вне допустимого диапазона — введите корректное',
  bad_value: 'Неверное значение',
}

export async function POST(req: NextRequest, { params }: { params: { id: string; discrepancyId: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g
  if (!isUuid(params.discrepancyId)) return badRequest(ERRORS.not_found, 404)

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest('Неверный запрос')

  const out = await resolveDiscrepancy(sb, companyId, params.discrepancyId, parsed.data, { userId: actor.id, expert: true })
  if (!out.ok) {
    if (out.status === 500) console.error('[giga-admin/point-a/discrepancies]', out.error)
    return badRequest(ERRORS[out.error] ?? 'Не удалось сохранить решение', out.status)
  }

  await recordAdminAction(actor, {
    action: 'point_a.discrepancy_resolved',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    newValue: { choice: parsed.data.choice, status: out.status, value: out.value },
    metadata: { discrepancyId: params.discrepancyId, overrides: out.overrides },
  }, req)

  emitPlatformEventSafely({
    name: 'DISCREPANCY_RESOLVED', companyId, subjectType: 'discrepancy', subjectId: params.discrepancyId, actor: `giga:${actor.id}`,
    payload: { status: out.status, value: out.value, overrides: out.overrides }, dedupeKey: `discrepancy_resolved:${params.discrepancyId}`,
  })
  refreshCompanyDataInBackground(companyId)

  return NextResponse.json({ ok: true, data: { status: out.status, value: out.value, overrides: out.overrides } })
}
