export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { analyzeWithLlm } from '@/lib/assistant/llm-analyzer'
import { hasOpenRouterKey } from '@/lib/ai/structured'
import type { LlmAnalysis } from '@/lib/assistant/types'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * POST /api/v1/assistant/analyze
 *
 * Triggers the Layer-3 LLM situational analysis (analyzeWithLlm) for the CURRENT
 * authenticated user (cookie session — never a user_id param, same IDOR guard as
 * point-b/route.ts). Honest by construction:
 *   - no OPENROUTER_API_KEY      → llm_status 'none',  analysis null
 *   - request/parse failure      → llm_status 'failed', analysis null
 *   - analyzer flags gaps        → llm_status 'insufficient_data'
 *   - otherwise                  → llm_status 'completed'
 *
 * The result is written to the is_current assistant_runs row via the service role
 * (non-fatal). Costly — kept off the hot /status path; callers poll /status.
 */
type LlmStatus = 'none' | 'completed' | 'failed' | 'insufficient_data'

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Throttle this costly Layer-3 LLM analysis per user (audit 2026-07-02).
  if (await isRateLimitedKey(user.id, 'assistant-analyze', { max: 6, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  // Portal locale from the caller's cookie (no server-to-server fire here).
  const locale = localeFromRequestCookie(req)

  try {
    const ctx = await buildAssistantContext(user.id, sb)

    let analysis: LlmAnalysis | null = null
    let llm_status: LlmStatus

    if (!hasOpenRouterKey()) {
      // Honest degradation — no fabrication when the model is unavailable.
      llm_status = 'none'
    } else {
      analysis = await analyzeWithLlm(ctx, locale)
      if (!analysis) {
        // analyzeWithLlm never throws — null means the call/parse failed.
        llm_status = 'failed'
      } else if (analysis.insufficient_data) {
        llm_status = 'insufficient_data'
      } else {
        llm_status = 'completed'
      }
    }

    // Persist llm_analysis + llm_status onto the is_current run (service role,
    // non-fatal). Reuse the existing is_current row when present so the
    // deterministic snapshot written by /status is preserved.
    try {
      const { createClient: createSrClient } = await import('@supabase/supabase-js')
      const admin = createSrClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )

      const { data: existing } = await admin
        .from('assistant_runs')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .maybeSingle()

      if (existing) {
        await admin
          .from('assistant_runs')
          .update({ llm_analysis: analysis, llm_status })
          .eq('id', existing.id)
      } else {
        // No /status run yet — seed a minimal current row carrying the analysis.
        await admin.from('assistant_runs').insert({
          user_id: user.id,
          diagnostic_id: ctx.diagnosticId,
          overall_pct: 0,
          status: 'in_progress',
          completion: {},
          issues: [],
          llm_analysis: analysis,
          llm_status,
          is_current: true,
        })
      }
    } catch (persistErr) {
      console.error('[assistant/analyze] persist failed (non-fatal):', persistErr)
    }

    return NextResponse.json({ ok: true, llm_status, analysis })
  } catch (error) {
    console.error('[assistant/analyze] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
