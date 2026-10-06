export const dynamic = 'force-dynamic'
// Full Point A analysis is a large structured generation (~4-5K tokens) that can
// take 90-150s on Claude Sonnet. This route runs async (fire-and-forget from
// recalculate, polled via ai-status), so a generous budget is fine.
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { analyzePointA } from '@/lib/ai/point-a-analyzer'
import { mergeAiAnalysis } from '@/lib/point-a/ai-analysis'
import type { GriExpertNotes } from '@/lib/ai/point-a-analyzer'
import { calculatePointA } from '@/lib/point-a-engine'
import type { Company } from '@/types/onboarding'
import { localeFromRequestCookie, normalizeLocale } from '@/lib/i18n/locale'
import { hasValidInternalToken } from '@/lib/internal-auth'
import { getSessionUser, getSessionRole, isStaffRole } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * POST /api/v1/diagnostics/ai-analyze
 * Internal endpoint: runs AI analysis on an existing diagnostic.
 * Called asynchronously after rule-based recalculation completes.
 *
 * Body: { diagnostic_id, user_id }
 *
 * Storage (lib/point-a/ai-analysis.ts, migration 091): the result goes to
 * diagnostics.ai_analysis MERGED with the keys of the current value this route
 * does not own (e.g. `gri`, `pulse` read by the expert routes); the Point A
 * narrative lives in ai_narrative and is never touched here.
 * After the caller is authorised, the route reads and writes with the service
 * role, scoped to the diagnostic of `user_id`: it is usually called
 * server-to-server without cookies, where the session client is anonymous —
 * RLS then hid the survey answers and dropped every write (`diagnostics` has
 * no UPDATE policy for API roles).
 */
export async function POST(req: NextRequest) {
  try {
    const { diagnostic_id, user_id, locale: bodyLocale } = await req.json()
    if (!diagnostic_id || !user_id) {
      return NextResponse.json({ ok: false, error: 'diagnostic_id and user_id required' }, { status: 400 })
    }

    const sb = createServerClient()

    // SECURITY (audit 2026-07-02): this internal endpoint runs 4 paid AI calls.
    // It is normally fired server-to-server from recalculate/retry-ai, which
    // carry a signed internal token (cookies aren't forwarded). Accept that
    // token; otherwise require a session that owns `user_id` (or staff), and
    // throttle that direct path. Anonymous callers can no longer burn credits.
    if (!hasValidInternalToken(req)) {
      const caller = await getSessionUser(sb)
      if (!caller) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
      if (caller.id !== user_id && !isStaffRole(await getSessionRole(sb, caller.id))) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
      }
      if (await isRateLimitedKey(caller.id, 'diagnostics-ai-analyze', { max: 6, windowMs: 60_000 })) {
        return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
      }
    }

    // Server-to-server fires (recalculate → ai-analyze) do NOT forward cookies,
    // so the caller's locale arrives in the body. Fall back to this request's
    // cookie (direct invocation), then the portal default.
    const locale = bodyLocale != null
      ? normalizeLocale(String(bodyLocale))
      : localeFromRequestCookie(req)

    const db = createServiceClient()

    // The diagnostic must belong to user_id — checked before any paid call.
    const { data: owned, error: ownErr } = await db
      .from('diagnostics')
      .select('id')
      .eq('id', diagnostic_id)
      .eq('user_id', user_id)
      .maybeSingle()
    if (ownErr) {
      console.error('[ai-analyze] diagnostic lookup failed', ownErr.code ?? '', ownErr.message ?? '')
      return NextResponse.json({ ok: false, error: 'Не удалось загрузить диагностику' }, { status: 500 })
    }
    if (!owned) return NextResponse.json({ ok: false, error: 'Диагностика не найдена' }, { status: 404 })

    // 1. Mark as processing
    await db
      .from('diagnostics')
      .update({ ai_status: 'processing' })
      .eq('id', diagnostic_id)
      .eq('user_id', user_id)

    // 2. Fetch survey answers
    const { data: rows } = await db
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)

    const answers: Record<string, unknown> = {}
    for (const row of (rows ?? [])) {
      answers[row.question_key] = (row.answer as { value: unknown }).value
    }

    // 3. Fetch company
    const { data: company } = await db
      .from('companies')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle()

    // 4. Fetch GRI expert notes (step=0, gri_expert_* keys)
    const { data: expertRows } = await db
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)
      .eq('step', 0)
      .like('question_key', 'gri_expert_%')

    const expertNotes: GriExpertNotes = {}
    for (const row of (expertRows ?? [])) {
      const block = row.question_key.replace('gri_expert_', '') as keyof GriExpertNotes
      const value = (row.answer as { value: unknown })?.value
      if (typeof value === 'string' && value.trim()) {
        expertNotes[block] = value
      }
    }

    // 5. Run rule-based engine to get PointA structure
    const pointA = calculatePointA(answers)

    // 6. Run AI analysis (with expert notes)
    const aiResult = await analyzePointA(answers, pointA, company as Company | null, expertNotes, locale)

    if (aiResult) {
      // 7. Store result, keeping keys of the current value this route does not
      //    own. Re-read right before writing: the analysis takes minutes.
      const { data: current } = await db
        .from('diagnostics')
        .select('ai_analysis')
        .eq('id', diagnostic_id)
        .eq('user_id', user_id)
        .maybeSingle()
      const { error: saveErr } = await db
        .from('diagnostics')
        .update({ ai_analysis: mergeAiAnalysis(current?.ai_analysis ?? null, aiResult), ai_status: 'completed' })
        .eq('id', diagnostic_id)
        .eq('user_id', user_id)
      if (saveErr) {
        console.error('[ai-analyze] save failed', saveErr.code ?? '', saveErr.message ?? '')
        return NextResponse.json({ ok: false, ai_status: 'failed', error: 'Анализ получен, но не сохранён' }, { status: 500 })
      }

      return NextResponse.json({ ok: true, ai_status: 'completed' })
    } else {
      await db
        .from('diagnostics')
        .update({ ai_status: 'failed' })
        .eq('id', diagnostic_id)
        .eq('user_id', user_id)

      return NextResponse.json({ ok: false, ai_status: 'failed', error: 'AI analysis returned null' })
    }
  } catch (error) {
    console.error('[ai-analyze] Error:', error)

    // Try to mark as failed if we have the diagnostic_id
    try {
      const body = await req.clone().json().catch(() => ({}))
      if (body.diagnostic_id && body.user_id) {
        await createServiceClient()
          .from('diagnostics')
          .update({ ai_status: 'failed' })
          .eq('id', body.diagnostic_id)
          .eq('user_id', body.user_id)
      }
    } catch { /* best effort */ }

    return NextResponse.json({ ok: false, error: 'AI analysis failed' }, { status: 500 })
  }
}
