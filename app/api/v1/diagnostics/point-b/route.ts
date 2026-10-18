export const dynamic = 'force-dynamic'

import { loadGoalsWithEvaluation } from '@/lib/goals/current'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import type { PointBV2 } from '@/lib/point-b/engine'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { computePointB } from '@/lib/point-b/compute'
import { loadExpertVersionForClient } from '@/lib/point-b/compat'
import { trackUserAction } from '@/lib/events/server'
import { gateFeature } from '@/lib/access/gate'

/**
 * GET /api/v1/diagnostics/point-b
 *
 * Goal-driven Point B for the CURRENT authenticated user. The user is taken
 * from the session — never from a `user_id` query param — so one user can't
 * read another's plan (see technical-audit A5 / IDOR). Expert/admin views of a
 * specific client go through /api/clients/[id]/analysis/point-b instead.
 *
 * Computed on the fly from the latest diagnostic (Point A) + survey answers +
 * GRI TOP-5. Nothing is fabricated: missing goals/revenue surface as an honest
 * "insufficient data" state, not a made-up target.
 */

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Tariff gate (Pro): off while the `access_gates` master switch is off; staff are exempt.
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  try {
    // 1–5. Everything Point B reads, once, for the SESSION user (lib/point-b/inputs.ts):
    //      the current diagnostic, the Point A v4 snapshot, survey answers, GRI TOP-5,
    //      registry metrics (revenue with its period), goals. Nothing is fabricated:
    //      a client without a diagnostic gets «нет данных», not zero blocks.
    const inputs = await loadPointBInputs(sb, user.id)
    const pointB = computePointB(inputs)
    if (!pointB || !inputs.diagnostic) {
      return NextResponse.json({ ok: true, data: null, reason: 'no_diagnostic' })
    }
    const diag = inputs.diagnostic
    const companyId = inputs.companyId

    // 6. Persist the current snapshot. One is_current row per diagnostic — full
    //    PointBV2 lives in `roadmap`; scalar columns mirror it for queryability.
    //    Writes via the SERVICE ROLE (point_b_analysis RLS has no owner-write
    //    policy on prod, which silently no-op'd session writes). Non-fatal.
    //
    //    The async AI bridge (POST /point-b/ai-generate) owns ai_strategy +
    //    ai_status. GET only recomputes the rule-based snapshot, so it must
    //    READ-THEN-MERGE those two columns — never clobber them with the engine
    //    defaults (null/'none'). We overlay the persisted values back onto the
    //    response below so the client sees the AI strategy when it exists.
    let aiStrategy: Record<string, unknown> | null = pointB.ai_strategy
    let aiStatus: PointBV2['ai_status'] = pointB.ai_status
    try {
      const { createClient: createSrClient } = await import('@supabase/supabase-js')
      const admin = createSrClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const { data: existing } = await admin
        .from('point_b_analysis')
        .select('id, ai_strategy, ai_status')
        .eq('diagnostic_id', diag.id as string)
        .eq('is_current', true)
        .maybeSingle()

      // Preserve any AI bridge result already written by ai-generate.
      if (existing) {
        aiStrategy = (existing.ai_strategy as Record<string, unknown> | null) ?? null
        aiStatus = (existing.ai_status as PointBV2['ai_status'] | null) ?? 'none'
      }

      const payload = {
        diagnostic_id: diag.id as string,
        horizon_months: 36,
        target_overall: pointB.target_overall_score,
        target_health: pointB.target_health_index,
        target_stage: pointB.target_stage,
        target_blocks: pointB.target_blocks,
        target_kpis: pointB.levers,
        gap_analysis: pointB.gap,
        roadmap: pointB,
        is_current: true,
        calculated_at: pointB.generated_at,
      }
      if (existing) {
        // Note: ai_strategy + ai_status intentionally omitted — only ai-generate
        // mutates them, so the recompute never clobbers an existing AI bridge.
        await admin.from('point_b_analysis').update(payload).eq('id', existing.id)
      } else {
        // First snapshot — seed the AI fields to the engine defaults (none/null).
        await admin.from('point_b_analysis').insert({
          ...payload,
          ai_strategy: aiStrategy,
          ai_status: aiStatus,
        })
      }
    } catch (persistErr) {
      console.error('[point-b] persist failed (non-fatal):', persistErr)
    }

    // Overlay the persisted AI bridge onto the live recompute (engine emits
    // null/'none'; the persisted row may hold a completed strategy).
    pointB.ai_strategy = aiStrategy
    pointB.ai_status = aiStatus

    // Goals on any metric (lib/goals): the gap А→Б, pace and realism of each.
    if (companyId) {
      pointB.metric_goals = await loadGoalsWithEvaluation(sb, companyId).catch((err) => {
        console.error('[point-b] goals not loaded (non-fatal):', err instanceof Error ? err.message : err)
        return []
      })
    }

    // 7. The expert version: the PUBLISHED (approved) version of the client's plan, otherwise the
    //    latest approved legacy correction (lib/point-b/compat.ts). Drafts and versions waiting for
    //    approval are never shown — filtered there and by the owner RLS policies.
    const ev = await loadExpertVersionForClient(sb, { companyId, diagnosticId: diag.id as string })

    // PointBContainer is the only caller of this route → a fetch = a view of Point B.
    void trackUserAction({ userId: user.id, name: 'POINT_B_VIEWED', entityType: 'diagnostic', entityId: diag.id as string, metadata: { expert_version: !!ev } })
    return NextResponse.json({ ok: true, data: pointB, expert_version: ev ?? null })
  } catch (error) {
    console.error('[point-b] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
