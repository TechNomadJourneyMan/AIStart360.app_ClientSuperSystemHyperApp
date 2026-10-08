export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { calculatePointA } from '@/lib/point-a-engine'
import { loadResolvedInputs } from '@/lib/point-a/resolved-inputs'
import { notifyAdmins } from '@/lib/notifications'
import { notifyPointARecalculated } from '@/lib/notifications/product'
import { runInBackground } from '@/lib/background'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { getSessionUser, resolveTargetUserId } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { trackEvent } from '@/lib/events/track'
import { internalBaseUrl, internalFetchHeaders } from '@/lib/internal-auth'

// POST /api/v1/diagnostics/recalculate
// Body: { user_id? } — the target user; defaults to the session user.
//
// After the caller is authorised (self, or staff for a client), every read and
// write is done with the service role scoped to the target user: `diagnostics`
// has no UPDATE policy for API roles, so with the session client the previous
// current row was never retired (UPDATE 0) and each recalculation added another
// is_current=true row; a staff insert for a client was rejected by
// diagnostics_insert_own. Migration 097 also enforces one current row per user.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const sb = createServerClient()

    // SECURITY (audit 2026-07-02): this endpoint recomputes a diagnostic and
    // fires 2 paid AI fan-outs. It previously took `user_id` from the body with
    // NO auth — anonymous cost/DoS + cross-tenant trigger. Derive identity from
    // the session (staff may target a client) and throttle per user.
    const resolved = await resolveTargetUserId(sb, (body as { user_id?: string }).user_id)
    if ('error' in resolved) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.error === 'unauthorized' ? 401 : 403 })
    }
    const user_id = resolved.userId
    // Who asked (staff acting for a client is not the client) — for the audit trail.
    const caller = await getSessionUser(sb)
    const requestedBy = `user:${caller?.id ?? user_id}`

    if (await isRateLimitedKey(user_id, 'diagnostics-recalculate', { max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    // The caller's portal locale lives in this request's cookie. Server-to-server
    // fires below do NOT forward cookies, so we pass it explicitly in their bodies.
    const locale = localeFromRequestCookie(req)

    const db = createServiceClient()

    // Fetch all survey answers for this user
    const { data: rows, error: surveyErr } = await db
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)

    if (surveyErr) return NextResponse.json({ ok: false, error: 'Failed to load survey answers' }, { status: 500 })

    // Build flat answers map
    const answers: Record<string, unknown> = {}
    for (const row of (rows ?? [])) {
      answers[row.question_key] = (row.answer as { value: unknown }).value
    }

    if (Object.keys(answers).length === 0) {
      return NextResponse.json({ ok: false, error: 'No survey answers found — complete the wizard first' }, { status: 422 })
    }

    // Get company_id
    const { data: company, error: companyErr } = await db
      .from('companies')
      .select('id')
      .eq('user_id', user_id)
      .maybeSingle()
    if (companyErr) {
      console.error('[recalculate] company lookup failed', companyErr.code ?? '', companyErr.message ?? '')
      return NextResponse.json({ ok: false, error: 'Failed to load company' }, { status: 500 })
    }

    // Calculate Point A. Materialised metric values from documents / manual /
    // external sources (LTV, CAC, margin) are used before survey answers. A
    // failed read is an error, not «no document values»: scoring from the
    // survey alone would silently replace a correct current diagnostic.
    let resolvedInputs
    try {
      resolvedInputs = await loadResolvedInputs(db, company?.id ?? null)
    } catch (err) {
      console.error('[recalculate] resolved inputs failed', err instanceof Error ? err.message : err)
      return NextResponse.json({ ok: false, error: 'Failed to load metric values' }, { status: 500 })
    }
    const result = calculatePointA(answers, resolvedInputs)

    // Retire the previous current diagnostic(s) of this user before inserting
    // the new one, so exactly one row stays is_current=true (downstream
    // `.single()/.maybeSingle()` reads — Point A current, Point B — need it).
    const { data: currentRows, error: currentErr } = await db
      .from('diagnostics')
      .select('id')
      .eq('user_id', user_id)
      .eq('is_current', true)
      .order('calculated_at', { ascending: false })
    if (currentErr) {
      console.error('[recalculate] current lookup failed', currentErr.code ?? '', currentErr.message ?? '')
      return NextResponse.json({ ok: false, error: 'Failed to store diagnostic' }, { status: 500 })
    }
    const retiredIds = ((currentRows ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (retiredIds.length) {
      const { error: retireErr } = await db
        .from('diagnostics')
        .update({ is_current: false })
        .eq('user_id', user_id)
        .in('id', retiredIds)
      if (retireErr) {
        console.error('[recalculate] retire failed', retireErr.code ?? '', retireErr.message ?? '')
        return NextResponse.json({ ok: false, error: 'Failed to store diagnostic' }, { status: 500 })
      }
    }

    // Store in diagnostics table
    const { data: diag, error: diagErr } = await db
      .from('diagnostics')
      .insert({
        user_id,
        company_id: company?.id ?? null,
        overall_score: result.overall_score,
        health_index: result.health_index,
        stage: result.stage,
        finance_score: result.blocks.finance,
        marketing_score: result.blocks.marketing,
        operations_score: result.blocks.operations,
        strategy_score: result.blocks.strategy,
        sales_score: result.blocks.sales,
        risks: result.risks,
        insights: result.insights,
        quick_wins: result.quick_wins,
        data_gaps: result.data_gaps,
        is_current: true,
        ai_status: process.env.OPENROUTER_API_KEY ? 'processing' : 'none',
      })
      .select()
      .single()

    if (diagErr) {
      console.error('[recalculate] insert failed', diagErr.code ?? '', diagErr.message ?? '')
      // Put the previous current row back: the user must not lose their Point A.
      if (retiredIds[0]) {
        const { error: restoreErr } = await db
          .from('diagnostics')
          .update({ is_current: true })
          .eq('user_id', user_id)
          .eq('id', retiredIds[0])
        if (restoreErr) console.error('[recalculate] restore failed', restoreErr.code ?? '', restoreErr.message ?? '')
      }
      return NextResponse.json({ ok: false, error: 'Failed to store diagnostic' }, { status: 500 })
    }
    void trackEvent({ userId: user_id, name: 'POINT_A_CALCULATED', entityType: 'diagnostic', entityId: diag?.id ?? null, metadata: { overall_score: Number(result.overall_score) } })

    // Fire async AI analysis (non-blocking)
    // Base URL from configuration, never the request Host in production (a
    // spoofed Host would receive the token); unknown → no fan-out.
    const baseUrl = internalBaseUrl(req)
    if (process.env.OPENROUTER_API_KEY && diag?.id && baseUrl) {
      const diagnosticId = String(diag.id)
      // Point A full analysis. Cookies aren't forwarded, so pass locale in body
      // and a signed internal token, bound to the target path, user and
      // diagnostic, so the (guarded) endpoint trusts exactly this call.
      const analyzePath = '/api/v1/diagnostics/ai-analyze'
      fetch(`${baseUrl}${analyzePath}`, {
        method: 'POST',
        headers: internalFetchHeaders({}, { path: analyzePath, userId: user_id, diagnosticId }),
        body: JSON.stringify({ diagnostic_id: diagnosticId, user_id, locale }),
      }).catch(err => console.error('[recalculate] Failed to fire AI analysis:', err))

      // Point B strategic bridge (AUTO trigger). Self-guards on insufficient
      // data, so firing it unconditionally here is safe. Pass locale in body.
      const pointBPath = '/api/v1/diagnostics/point-b/ai-generate'
      fetch(`${baseUrl}${pointBPath}`, {
        method: 'POST',
        headers: internalFetchHeaders({}, { path: pointBPath, userId: user_id, diagnosticId }),
        body: JSON.stringify({ diagnostic_id: diagnosticId, user_id, locale }),
      }).catch(err => console.error('[recalculate] Failed to fire Point B AI generate:', err))
    } else if (process.env.OPENROUTER_API_KEY && diag?.id) {
      console.error('[recalculate] AI fan-out skipped: no trusted base URL (NEXT_PUBLIC_APP_URL)')
    }

    // The diagnostic pipeline (metrics → data quality → benchmarks → hypotheses
    // → recommendations) runs as agents; it reuses this calculation when the
    // inputs are unchanged. Never blocks or fails the response.
    if (company?.id && diag?.id) {
      const companyId = String(company.id)
      const diagnosticId = String(diag.id)
      void runInBackground('diagnostic-orchestrator', async () => {
        try {
          const { enqueueAgentTask } = await import('@/lib/agents/queue')
          await enqueueAgentTask({
            agentKey: 'diagnostic_orchestrator',
            companyId,
            trigger: 'manual',
            triggerRef: 'recalculate',
            requestedBy,
            input: { action: 'start', trigger: 'manual', reason: 'пересчёт по запросу' },
            idempotencyKey: `recalc:${diagnosticId}`,
          })
        } catch (err) {
          console.error('[recalculate] diagnostic pipeline not started:', err instanceof Error ? err.message : err)
        }
      })
    }

    // Клиенту: «Точка А пересчитана» (лента; email — по настройке «reports»).
    runInBackground('point-a-notify', () =>
      notifyPointARecalculated(user_id, { diagnosticId: diag?.id ?? null, overallScore: Number(result.overall_score) }),
    )

    // Notify admins about diagnostic recalculation
    notifyAdmins('diagnostic_recalculated', {
      overallScore: result.overall_score,
      stage: result.stage ?? null,
      diagnosticId: diag?.id,
    }, user_id)

    return NextResponse.json({ ok: true, data: { diagnostic: diag, point_a: result } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
