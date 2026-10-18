export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { gateFeature } from '@/lib/access/gate'
import { activeImpersonation } from '@/lib/impersonation/server'
import { fail, finmodelDefsView, finmodelFailure, loadFinmodelForUser, parseValuesBody } from '@/lib/point-b/finmodel/service'
import { saveFinmodelValues } from '@/lib/point-b/finmodel/store'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/v1/point-b/finmodel — the «Финмодель» of the owner (level 2 of Point B):
 *   { ok, data: { defs: [{ key, label, unit, hint, unlocks, required, conditional, min, max, group }],
 *                 state: { values, missing, complete, defaulted, facts } } }
 * `state.values` is the merge of what the owner / the expert typed, the questionnaire and the industry
 * assumptions (tax and the working-capital days only; they are in `defaulted`). Percent values are
 * FRACTIONS (0.1 = 10%).
 *
 * PUT /api/v1/point-b/finmodel { values: [{ key, value, asOf?, period?, note? }] } (1..20 values)
 *   → { ok, data: { state } }. A value typed again is `entered` again (an expert's check is gone).
 *   400 { code: 'invalid_value' | 'unknown_key' | 'profanity' | 'invalid_request', field? } with a text for the user.
 *
 * The user comes from the session only. Pro feature: 402 for a free client while the access gates are
 * on (staff exempt). Writing is refused «от имени» (403) and limited to 30 requests per 10 minutes.
 * Saving does NOT recalculate Point A: the finmodel is not a Point A metric.
 */
const NO_COMPANY = 'Сначала создайте компанию — финмодели не к чему привязаться'

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  try {
    const service = createServiceClient()
    const company = await companyOfUser(service, user.id)
    const state = await loadFinmodelForUser(service, { userId: user.id, companyId: company?.id ?? null })
    return NextResponse.json({ ok: true, data: { defs: finmodelDefsView(), state } })
  } catch (err) {
    console.error('[v1/point-b/finmodel GET]', err instanceof Error ? err.message : err)
    return fail('Не удалось загрузить финмодель', 500)
  }
}

export async function PUT(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return fail('В режиме «от имени» вводить данные финмодели нельзя: их вводит сам владелец.', 403)
  }
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade
  if (await isRateLimitedKey(user.id, 'point-b:finmodel', { max: 30, windowMs: 10 * 60_000 })) {
    return fail('Слишком много сохранений подряд — подождите несколько минут', 429)
  }

  const parsed = parseValuesBody(await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  try {
    const service = createServiceClient()
    const company = await companyOfUser(service, user.id)
    if (!company) return fail(NO_COMPANY, 404, { code: 'no_company' })
    await saveFinmodelValues(service, {
      companyId: company.id,
      actor: { id: user.id, role: 'owner', name: null },
      values: parsed.values,
    })
    const state = await loadFinmodelForUser(service, { userId: user.id, companyId: company.id })
    return NextResponse.json({ ok: true, data: { state } })
  } catch (err) {
    const answer = finmodelFailure(err)
    if (answer) return answer
    console.error('[v1/point-b/finmodel PUT]', err instanceof Error ? err.message : err)
    return fail('Не удалось сохранить финмодель', 500)
  }
}
