export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { runWhatIf, validateWhatIf } from '@/lib/point-b/model/whatif'
import { authorize, fail, whatIfFailure } from '@/lib/point-b/whatif-http'
import { loadWhatIfInputs, profileOf, SCENARIO_KEYS, type ScenarioKey } from '@/lib/point-b/whatif-store'

/**
 * POST /api/v1/point-b/whatif { changes: WhatIfChange[], scenario?: 'cautious' | 'moderate' | 'aggressive' }
 *   → { ok, data: WhatIfResult }
 * The «Что если» calculation (plan Ф4): the whole model of the client recalculated with the changed INPUTS.
 * It WRITES NOTHING — not to the plan, not to the database. `changes: []` returns the baseline and what each
 * calculator can do for this client (`applicable`), which is how the tab opens.
 *
 * The user comes from the session only (the body carries no ids). Pro feature: 402 for a free client while the
 * access gates are on (staff exempt). Reading is allowed «от имени». 60 requests per 10 minutes per user (429).
 * 400 { ok: false, error, code: 'invalid_request', field } — out-of-range or repeated changes, a start beyond the
 * horizon, an unknown scenario; `field` is e.g. `changes[1].pp`. The text is for the user, in Russian.
 */
export async function POST(req: NextRequest) {
  const auth = await authorize({ write: false, bucket: 'point-b:whatif', max: 60 })
  if (!auth.ok) return auth.response

  const raw = (await req.json().catch(() => null)) as { changes?: unknown; scenario?: unknown } | null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Передайте список изменений', 400, { code: 'invalid_request', field: 'changes' })
  const scenario = raw.scenario
  if (scenario !== undefined && scenario !== null && !(SCENARIO_KEYS as readonly unknown[]).includes(scenario)) {
    return fail('Неизвестный сценарий темпа: допустимы осторожный, умеренный и агрессивный', 400, { code: 'invalid_request', field: 'scenario' })
  }
  const checked = validateWhatIf(raw.changes)
  if (!checked.ok) return fail(checked.error, 400, { code: 'invalid_request', field: checked.field })

  try {
    const { inputs } = await loadWhatIfInputs(auth.caller.service, auth.caller.userId)
    const profile = profileOf(inputs, (scenario ?? undefined) as ScenarioKey | undefined)
    const data = runWhatIf(inputs, checked.changes, { profile })
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const answer = whatIfFailure(err)
    if (answer) return answer
    console.error('[v1/point-b/whatif POST]', err instanceof Error ? err.message : err)
    return fail('Не удалось посчитать «Что если»', 500)
  }
}
