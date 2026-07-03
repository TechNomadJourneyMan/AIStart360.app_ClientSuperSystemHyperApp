export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateNarrative, type NarrativeInput, type PointANarrative } from '@/lib/point-a/narrative'
import type { Company, Diagnostic, PointA } from '@/types/onboarding'
import { isRateLimitedKey } from '@/lib/rate-limit'

/**
 * POST /api/v1/point-a/narrative
 *
 * Body: { regenerate?: boolean }
 *
 * 1. Auth the user.
 * 2. Load the current diagnostic (`is_current=true`) for the user.
 * 3. If `ai_status === 'completed'` and `!regenerate`, return cached `ai_analysis`.
 * 4. Otherwise build a `NarrativeInput` from the company + current PointA and call `generateNarrative`.
 * 5. Persist result (`ai_analysis` + `ai_status`) and return it.
 */
export async function POST(req: NextRequest) {
  const sb = await createClient()

  // 1. Auth
  const {
    data: { user },
    error: authErr,
  } = await sb.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Throttle this paid Sonnet narrative generation per user (audit 2026-07-02).
  if (await isRateLimitedKey(user.id, 'point-a-narrative', { max: 6, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  // Body — best-effort parse, never throw.
  let regenerate = false
  try {
    const body = (await req.json().catch(() => ({}))) as { regenerate?: boolean }
    regenerate = Boolean(body?.regenerate)
  } catch {
    regenerate = false
  }

  // 2. Fetch current diagnostic
  const { data: diagRow, error: diagErr } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()

  if (diagErr) {
    return NextResponse.json({ ok: false, error: diagErr.message }, { status: 500 })
  }
  if (!diagRow) {
    return NextResponse.json(
      { ok: false, error: 'no current diagnostic' },
      { status: 404 },
    )
  }

  const diagnostic = diagRow as Diagnostic

  // 3. Return cached narrative if completed and no regenerate flag
  if (!regenerate && diagnostic.ai_status === 'completed' && diagnostic.ai_analysis) {
    return NextResponse.json({
      ok: true,
      data: diagnostic.ai_analysis as unknown as PointANarrative,
      cached: true,
    })
  }

  // 4. Fetch company
  const { data: companyRow } = await sb
    .from('companies')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  const company = (companyRow ?? null) as Company | null

  // Build PointA structure from the diagnostic row.
  const pointA: PointA = {
    overall_score: diagnostic.overall_score ?? 0,
    health_index: diagnostic.health_index ?? 0,
    stage: diagnostic.stage ?? 'seed',
    blocks: {
      finance: diagnostic.finance_score ?? emptyBlock(),
      marketing: diagnostic.marketing_score ?? emptyBlock(),
      operations: diagnostic.operations_score ?? emptyBlock(),
      strategy: diagnostic.strategy_score ?? emptyBlock(),
      sales: diagnostic.sales_score ?? emptyBlock(),
    },
    risks: diagnostic.risks ?? [],
    insights: diagnostic.insights ?? [],
    quick_wins: diagnostic.quick_wins ?? [],
    data_gaps: diagnostic.data_gaps ?? [],
  }

  const input: NarrativeInput = {
    pointA,
    companyName: company?.name ?? 'Компания',
    industry: company?.industry ?? null,
    stage: company?.stage ?? null,
  }

  // Mark processing (best effort — never abort flow on error).
  await sb
    .from('diagnostics')
    .update({ ai_status: 'processing' })
    .eq('id', diagnostic.id)

  // 5. Generate narrative
  const narrative = await generateNarrative(input)

  if (narrative) {
    await sb
      .from('diagnostics')
      .update({ ai_analysis: narrative, ai_status: 'completed' })
      .eq('id', diagnostic.id)

    return NextResponse.json({ ok: true, data: narrative })
  }

  // 6. Failure path
  await sb
    .from('diagnostics')
    .update({ ai_status: 'failed' })
    .eq('id', diagnostic.id)

  return NextResponse.json({ ok: true, data: null })
}

function emptyBlock() {
  return {
    score: 0,
    status: 'critical' as const,
    top_issues: [],
    recommendations: [],
  }
}
