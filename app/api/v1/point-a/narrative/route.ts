export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { generateNarrative, type NarrativeInput } from '@/lib/point-a/narrative'
import { readNarrative } from '@/lib/point-a/ai-analysis'
import type { Company, Diagnostic, PointA } from '@/types/onboarding'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { apiError, dbError } from '@/lib/api-error'
import { guardAiBudget } from '@/lib/ai/budget'
import { recordAiCacheHit } from '@/lib/ai/usage'

/**
 * POST /api/v1/point-a/narrative
 *
 * Body: { regenerate?: boolean }
 *
 * 1. Auth the user.
 * 2. Load the user's current diagnostic (`is_current=true`) with their session (RLS).
 * 3. Unless `regenerate`, return the stored narrative: `diagnostics.ai_narrative`
 *    (migration 091), or a narrative left in `ai_analysis` by this route before 091.
 * 4. Otherwise build a `NarrativeInput` from the company + current PointA and call `generateNarrative`.
 * 5. Store it in `ai_narrative` only. `ai_analysis` / `ai_status` belong to the
 *    full AI analysis (POST /api/v1/diagnostics/ai-analyze) and are never touched
 *    here — before 091 this route overwrote them (lib/point-a/ai-analysis.ts).
 *    The write goes through the service role, scoped to the caller's own row:
 *    `diagnostics` has no UPDATE policy for API roles, so a session write was a
 *    silent no-op.
 */
export async function POST(req: NextRequest) {
  const sb = await createClient()

  // 1. Auth
  const {
    data: { user },
    error: authErr,
  } = await sb.auth.getUser()
  if (authErr || !user) {
    return apiError('Требуется вход в систему', 401)
  }

  // Throttle this paid Sonnet narrative generation per user (audit 2026-07-02).
  if (await isRateLimitedKey(user.id, 'point-a-narrative', { max: 6, windowMs: 60_000 })) {
    return apiError('Слишком много запросов. Попробуйте позже.', 429)
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

  if (diagErr) return dbError('v1/point-a/narrative', diagErr, 'Не удалось загрузить диагностику')
  if (!diagRow) return apiError('Диагностика ещё не рассчитана', 404)

  const diagnostic = diagRow as Diagnostic & { ai_narrative?: unknown }

  // 3. Stored narrative (never an AI analysis that happens to sit in ai_analysis).
  const stored = readNarrative(diagnostic)
  if (!regenerate && stored) {
    void recordAiCacheHit('point_a_narrative', { userId: user.id })
    return NextResponse.json({ ok: true, data: stored, cached: true })
  }

  const overBudget = await guardAiBudget(user.id, 'point_a_narrative')
  if (overBudget) return overBudget

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

  // 5. Generate and store in its own column.
  const narrative = await generateNarrative(input)
  if (!narrative) {
    return apiError('Не удалось сформировать резюме: модель недоступна или ответила неверно. Попробуйте позже.', 503)
  }

  const { error: saveErr } = await createServiceClient()
    .from('diagnostics')
    .update({ ai_narrative: narrative })
    .eq('id', diagnostic.id)
    .eq('user_id', user.id)
  if (saveErr) {
    console.error('[v1/point-a/narrative] save failed', saveErr.code ?? '', saveErr.message ?? '')
    return NextResponse.json({
      ok: true,
      data: narrative,
      persisted: false,
      warning: 'Резюме сформировано, но не сохранено — при следующем открытии оно будет построено заново.',
    })
  }
  return NextResponse.json({ ok: true, data: narrative, persisted: true })
}

function emptyBlock() {
  return {
    score: 0,
    status: 'critical' as const,
    top_issues: [],
    recommendations: [],
  }
}
