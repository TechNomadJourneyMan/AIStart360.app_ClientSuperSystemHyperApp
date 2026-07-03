export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { calculatePointA } from '@/lib/point-a-engine'
import { notifyAdmins } from '@/lib/notifications'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { resolveTargetUserId } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { internalFetchHeaders } from '@/lib/internal-auth'

// POST /api/v1/diagnostics/recalculate
// Body: { user_id? } — the target user; defaults to the session user.
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

    if (await isRateLimitedKey(user_id, 'diagnostics-recalculate', { max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    // The caller's portal locale lives in this request's cookie. Server-to-server
    // fires below do NOT forward cookies, so we pass it explicitly in their bodies.
    const locale = localeFromRequestCookie(req)

    // Fetch all survey answers for this user
    const { data: rows, error: surveyErr } = await sb
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
    const { data: company } = await sb
      .from('companies')
      .select('id')
      .eq('user_id', user_id)
      .single()

    // Calculate Point A
    const result = calculatePointA(answers)

    // Retire any previous current diagnostics for this user before inserting the
    // new one, so exactly one row stays is_current=true. Without this, repeated
    // recalculations accumulate multiple is_current rows and downstream
    // `.single()/.maybeSingle()` reads (Point A current, Point B) break.
    await sb
      .from('diagnostics')
      .update({ is_current: false })
      .eq('user_id', user_id)
      .eq('is_current', true)

    // Store in diagnostics table
    const { data: diag, error: diagErr } = await sb
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

    if (diagErr) return NextResponse.json({ ok: false, error: 'Failed to store diagnostic' }, { status: 500 })

    // Fire async AI analysis (non-blocking)
    if (process.env.OPENROUTER_API_KEY && diag?.id) {
      const baseUrl = req.nextUrl.origin
      // Point A full analysis. Cookies aren't forwarded, so pass locale in body
      // and a signed internal token so the (now-guarded) endpoint trusts us.
      fetch(`${baseUrl}/api/v1/diagnostics/ai-analyze`, {
        method: 'POST',
        headers: internalFetchHeaders(),
        body: JSON.stringify({ diagnostic_id: diag.id, user_id, locale }),
      }).catch(err => console.error('[recalculate] Failed to fire AI analysis:', err))

      // Point B strategic bridge (AUTO trigger). Self-guards on insufficient
      // data, so firing it unconditionally here is safe. Pass locale in body.
      fetch(`${baseUrl}/api/v1/diagnostics/point-b/ai-generate`, {
        method: 'POST',
        headers: internalFetchHeaders(),
        body: JSON.stringify({ diagnostic_id: diag.id, user_id, locale }),
      }).catch(err => console.error('[recalculate] Failed to fire Point B AI generate:', err))
    }

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
