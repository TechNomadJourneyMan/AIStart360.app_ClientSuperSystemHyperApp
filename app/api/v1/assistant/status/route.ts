export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { buildAssistantContext } from '@/lib/assistant/context'
import { computeCompletion, deriveStatus } from '@/lib/assistant/completion'
import { runValidation } from '@/lib/assistant/validators'
import type { ValidationIssue } from '@/lib/assistant/types'

/**
 * GET /api/v1/assistant/status
 *
 * Session-scoped readiness snapshot for the CURRENT authenticated user (taken
 * from the cookie via sb.auth.getUser() — NEVER a user_id query param, same IDOR
 * guard as app/api/v1/diagnostics/point-b/route.ts). Powers the dashboard hint
 * widget.
 *
 * Layers 1+2 only (deterministic field checks + inconsistency rules) — the LLM
 * is intentionally skipped here for speed; POST /api/v1/assistant/analyze owns
 * the costly Layer-3 pass. The computed is_current row is persisted to
 * assistant_runs via the service role (non-fatal, mirrors the point-b persist).
 */
export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Curated snapshot (RLS-scoped reads inside buildAssistantContext).
    const ctx = await buildAssistantContext(user.id, sb)

    // 2. Completion + deterministic/rule validation (no LLM on the hot path).
    const completion = computeCompletion(ctx)
    const issues = await runValidation(ctx, { includeLlm: false })

    // 3. Final status with the issue list folded in (errors → needs_attention).
    const status = deriveStatus(completion, issues, ctx.llm_analysis, ctx)
    completion.status = status

    // Top issues for the widget: errors first, then warnings (severity-sorted
    // already by runValidation), capped so the widget stays compact.
    const top_issues: ValidationIssue[] = issues
      .filter((i) => i.severity === 'error' || i.severity === 'warning')
      .slice(0, 5)

    const readiness = {
      status,
      overall_pct: completion.overall_pct,
      missing_required: completion.missing_required,
      can_run_analysis:
        status === 'ready_for_analysis' ||
        status === 'ready_for_expert_review' ||
        status === 'completed',
      error_count: issues.filter((i) => i.severity === 'error').length,
      warning_count: issues.filter((i) => i.severity === 'warning').length,
    }

    // 4. Persist the is_current snapshot via the service role (non-fatal). One
    //    is_current row per user — same discipline as point_b_analysis: flip the
    //    previous current rows off, then upsert the latest. LLM fields are left
    //    untouched here (only /analyze writes llm_analysis/llm_status).
    try {
      const { createClient: createSrClient } = await import('@supabase/supabase-js')
      const admin = createSrClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )

      const { data: existing } = await admin
        .from('assistant_runs')
        .select('id, llm_analysis, llm_status')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .maybeSingle()

      const payload = {
        user_id: user.id,
        diagnostic_id: ctx.diagnosticId,
        overall_pct: completion.overall_pct,
        status,
        completion,
        issues,
        is_current: true,
      }

      if (existing) {
        // Preserve any LLM analysis already written by /analyze; only refresh the
        // deterministic snapshot here.
        await admin.from('assistant_runs').update(payload).eq('id', existing.id)
      } else {
        await admin.from('assistant_runs').insert({
          ...payload,
          llm_analysis: null,
          llm_status: 'none',
        })
      }
    } catch (persistErr) {
      console.error('[assistant/status] persist failed (non-fatal):', persistErr)
    }

    return NextResponse.json({
      ok: true,
      completion,
      status,
      top_issues,
      readiness,
    })
  } catch (error) {
    console.error('[assistant/status] error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
