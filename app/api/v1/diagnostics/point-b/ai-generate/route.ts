export const dynamic = 'force-dynamic'
// Point B strategic bridge is a large structured generation (high complexity →
// Sonnet) that can take 90-150s. This route runs async (fire-and-forget from
// recalculate, polled via point-b/ai-status), so a generous budget is fine.
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { analyzePointBStrategy } from '@/lib/ai/point-b-analyzer'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { computePointB } from '@/lib/point-b/compute'
import { localeFromRequestCookie, normalizeLocale } from '@/lib/i18n/locale'
import { hasValidInternalToken } from '@/lib/internal-auth'
import { getSessionUser, getSessionRole, isStaffRole } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardAiBudget } from '@/lib/ai/budget'

/**
 * POST /api/v1/diagnostics/point-b/ai-generate
 * Internal endpoint: runs the Point B AI strategic-bridge analysis on a
 * diagnostic and persists it onto point_b_analysis (ai_strategy + ai_status).
 * Called asynchronously after rule-based recalculation completes (AUTO trigger).
 *
 * Body: { diagnostic_id?, user_id? } — falls back to the session user when omitted.
 *
 * HONEST DEGRADE: if the recomputed Point B has insufficient data, we set
 * ai_status='none' and return ok WITHOUT calling the LLM (never fabricate a plan).
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    let diagnosticId = (body.diagnostic_id as string | undefined) ?? undefined
    let userId = (body.user_id as string | undefined) ?? undefined

    // Locale: server-to-server fires (recalculate) pass it in the body since
    // cookies aren't forwarded; manual UI invocation falls back to the cookie.
    const locale = body.locale != null
      ? normalizeLocale(String(body.locale))
      : localeFromRequestCookie(req)

    const sb = createServerClient()

    // SECURITY (audit 2026-07-02): this runs a paid Point B AI generation. When
    // `user_id` is supplied it's a server-to-server fire from recalculate — trust
    // only a signed internal token (or a session that owns it). When omitted it's
    // a manual UI call — resolve from the session. Then throttle per user.
    // The internal token must be bound to exactly this user and diagnostic
    // (lib/internal-auth v2), so a token minted for another call is refused.
    const internal = userId ? hasValidInternalToken(req, { userId, diagnosticId }) : false
    if (userId) {
      if (!internal) {
        const caller = await getSessionUser(sb)
        if (!caller) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        if (caller.id !== userId && !isStaffRole(await getSessionRole(sb, caller.id))) {
          return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
        }
      }
    } else {
      const caller = await getSessionUser(sb)
      if (!caller) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
      }
      userId = caller.id
    }

    if (!internal && (await isRateLimitedKey(userId, 'diagnostics-point-b-ai', { max: 6, windowMs: 60_000 }))) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }
    const overBudget = await guardAiBudget(userId, 'point_b_strategy')
    if (overBudget) return overBudget

    // 1–5. Inputs (the diagnostic — the given one or the current one —, the Point A v4
    //      snapshot, survey answers, GRI TOP-5, registry metrics, goals) from the one loader
    //      every Point B surface uses, then the same computation.
    const inputs = await loadPointBInputs(sb, userId, { diagnosticId: diagnosticId ?? null })
    const pointB = computePointB(inputs)
    if (!pointB || !inputs.diagnostic) {
      return NextResponse.json({ ok: false, error: 'No diagnostic found' }, { status: 404 })
    }
    diagnosticId = String(inputs.diagnostic.id)

    const { data: comp } = await sb
      .from('companies')
      .select('name, industry, stage')
      .eq('user_id', userId)
      .maybeSingle()

    // Service-role client — point_b_analysis RLS has no owner-write policy on
    // prod, so session writes silently no-op. Only ai_strategy + ai_status are
    // mutated here (read-then-merge in GET preserves everything else).
    const { createClient: createSrClient } = await import('@supabase/supabase-js')
    const admin = createSrClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const writeAi = async (
      aiStatus: 'none' | 'processing' | 'completed' | 'failed',
      aiStrategy: Record<string, unknown> | null,
    ) => {
      const { data: existing } = await admin
        .from('point_b_analysis')
        .select('id')
        .eq('diagnostic_id', diagnosticId as string)
        .eq('is_current', true)
        .maybeSingle()
      const patch = { ai_status: aiStatus, ai_strategy: aiStrategy }
      if (existing) {
        await admin.from('point_b_analysis').update(patch).eq('id', existing.id)
      } else {
        // No snapshot yet (GET hasn't run). Seed a minimal current row so the
        // ai fields have somewhere to live; GET will fill the rest on next read.
        await admin.from('point_b_analysis').insert({
          diagnostic_id: diagnosticId as string,
          is_current: true,
          ...patch,
        })
      }
    }

    // 6. HONEST DEGRADE — insufficient data: skip the LLM entirely.
    if (pointB.data_sufficiency.sufficient === false) {
      await writeAi('none', null)
      return NextResponse.json({ ok: true, ai_status: 'none', reason: 'insufficient_data' })
    }

    // 7. Mark processing, run AI, persist result.
    await writeAi('processing', null)

    const company = comp
      ? {
          name: (comp.name as string | null) ?? null,
          industry: (comp.industry as string | null) ?? null,
          stage: (comp.stage as string | null) ?? null,
        }
      : null

    const strategy = await analyzePointBStrategy(pointB, company, locale)

    if (strategy) {
      await writeAi('completed', strategy as unknown as Record<string, unknown>)
      return NextResponse.json({ ok: true, ai_status: 'completed' })
    } else {
      await writeAi('failed', null)
      return NextResponse.json({ ok: false, ai_status: 'failed', error: 'AI analysis returned null' })
    }
  } catch (error) {
    console.error('[point-b/ai-generate] error:', error)

    // Best-effort: mark failed if we can resolve the diagnostic.
    try {
      const body = await req.clone().json().catch(() => ({} as Record<string, unknown>))
      const diagnosticId = body.diagnostic_id as string | undefined
      if (diagnosticId) {
        const { createClient: createSrClient } = await import('@supabase/supabase-js')
        const admin = createSrClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        )
        await admin
          .from('point_b_analysis')
          .update({ ai_status: 'failed' })
          .eq('diagnostic_id', diagnosticId)
          .eq('is_current', true)
      }
    } catch { /* best effort */ }

    return NextResponse.json({ ok: false, error: 'AI analysis failed' }, { status: 500 })
  }
}
