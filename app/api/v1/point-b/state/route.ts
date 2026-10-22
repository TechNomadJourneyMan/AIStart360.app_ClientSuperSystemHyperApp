export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { gateFeature } from '@/lib/access/gate'
import { loadPointBState } from '@/lib/point-b/model/load'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { trackUserAction } from '@/lib/events/server'

/**
 * GET /api/v1/point-b/state — the client page of Point B in one read (spec §16):
 *   { ok, data: { access: 'ok',
 *                 overview: { result: ModelResult, labelledAutomatic: true },
 *                 plan: { status: 'none' | 'preparing' | 'published', version, selectedScenario,
 *                         scenarios: ScenarioResult[], approvedAt, authorName } } }
 * `overview.result` is the automatic preliminary calculation (always, marked «не проверен экспертом»);
 * `plan.scenarios` are the scenarios of the APPROVED version only — never a draft or a version in review.
 * The user comes from the session only (an «от имени» session is the client's own: it reads, nothing is
 * written here). A user without a company or a goal gets a level-0 result, not an error. Pro feature:
 * 402 for a free client while the access gates are on (staff are exempt).
 */
export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  // The Pro gate and the read go out together (the read only reads): a gated user still gets the 402
  // and nothing else, everyone else saves the gate's round trip.
  const [upgrade, loaded] = await Promise.all([
    gateFeature(sb, user.id, 'point_b', { exemptStaff: true }),
    loadPointBState(createServiceClient(), user.id).then((data) => ({ data }), (error: unknown) => ({ error })),
  ])
  if (upgrade) return upgrade

  try {
    if ('error' in loaded) throw loaded.error
    const data = loaded.data
    // The page opens with this read (the details tab loads its own data lazily), so a fetch = a view of Point B.
    void trackUserAction({ userId: user.id, name: 'POINT_B_VIEWED', entityType: 'point_b', entityId: user.id, metadata: { level: data.overview.result.level, plan: data.plan.status } })
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error('[v1/point-b/state]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить Точку Б' }, { status: 500 })
  }
}
