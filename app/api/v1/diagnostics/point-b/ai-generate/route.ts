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
import { getSessionStaff, getSessionUser, mayActOnUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardAiBudget } from '@/lib/ai/budget'
import { gateFeature } from '@/lib/access/gate'
import { createServiceClient } from '@/lib/supabase-service'
import { withDeadline } from '@/lib/runtime/deadline'

/**
 * POST /api/v1/diagnostics/point-b/ai-generate
 * Runs the Point B AI strategic-bridge analysis on a diagnostic and persists it onto point_b_analysis
 * (ai_strategy + ai_status).
 *
 * R3 (S3, решение PO): the AI strategy of Точка Б is a DRAFT FOR STAFF only — the client never runs it and never
 * sees it. Only a staff session acting on a client it may manage (mayActOnUser: staff / active expert, second
 * factor passed, client scope) gets here, with `user_id` of that client in the body. The client's own call, a call
 * without `user_id` and the old internal fan-out token (the recalculation no longer fires it) → 403 staff_only;
 * nothing is read and no model is called.
 *
 * Body: { user_id, diagnostic_id? }.
 *
 * HONEST DEGRADE: if the recomputed Point B has insufficient data, we set
 * ai_status='none' and return ok WITHOUT calling the LLM (never fabricate a plan).
 */
const STAFF_ONLY_TEXT = 'ИИ-черновик стратегии Точки Б готовит команда AIStart360 — клиенту он не показывается'

const staffOnly = () => NextResponse.json({ ok: false, code: 'staff_only', error: STAFF_ONLY_TEXT }, { status: 403 })

async function handlePost(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    let diagnosticId = (body.diagnostic_id as string | undefined) ?? undefined
    const userId = (body.user_id as string | undefined) ?? undefined

    // Locale: server-to-server fires (recalculate) pass it in the body since
    // cookies aren't forwarded; manual UI invocation falls back to the cookie.
    const locale = body.locale != null
      ? normalizeLocale(String(body.locale))
      : localeFromRequestCookie(req)

    const sb = createServerClient()

    // SECURITY (audit 2026-07-02) + R3 (S3): a paid generation that only staff may start — a session of
    // staff acting on THIS client (mayActOnUser). No internal token (the fan-out no longer fires it), no self-call.
    const caller = await getSessionUser(sb)
    if (!caller) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (!userId || userId === caller.id) return staffOnly()
    // Staff of this session (migration 140 rule + the second factor), and the client inside its scope.
    if (!(await getSessionStaff(sb, caller.id))) return staffOnly()
    if (!(await mayActOnUser(sb, caller.id, userId))) return staffOnly()
    // The CLIENT's Point B must be open (Pro / override / gates off): a staff draft for a closed section is not made.
    // Read with the service client: a session cannot read another user's tier.
    const closed = await gateFeature(createServiceClient(), userId, 'point_b', { exemptStaff: true })
    if (closed) return closed

    if (await isRateLimitedKey(caller.id, 'diagnostics-point-b-ai', { max: 6, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }
    // The staff member's AI budget is spent (the client is not billed for a staff draft).
    const overBudget = await guardAiBudget(caller.id, 'point_b_strategy')
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

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After
 * 120 s the client gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline
 * spent (the fan-out waits 150 s (lib/point-a/diagnostic-row.ts); the model call inside is bounded by the AI deadline). ROUTE_DEADLINE_MS_POINT_B_AI_GENERATE overrides it; ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'point-b-ai-generate', ms: 120_000 })
