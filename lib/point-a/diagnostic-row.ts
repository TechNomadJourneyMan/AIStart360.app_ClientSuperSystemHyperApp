/**
 * lib/point-a/diagnostic-row.ts — store a Point A result as the current
 * public.diagnostics row and start what follows a recalculation. Shared by
 * POST /api/v1/diagnostics/recalculate and the event-driven snapshot
 * (lib/point-a/snapshot.ts).
 *
 * `db` must be the service role: diagnostics has no UPDATE policy for API
 * roles (the previous current row would never be retired) and migration 097
 * enforces one current row per user.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointA } from '@/types/onboarding'
import { internalFetchHeaders } from '@/lib/internal-auth'
import { runInBackground } from '@/lib/background'

export type StoreResult =
  | { ok: true; diag: Record<string, unknown> & { id: string } }
  | { ok: false; error: string }

/** Retire the current row(s) of the user, insert `result` as current; on a failed insert put the previous one back. */
export async function storeCurrentDiagnostic(
  db: SupabaseClient,
  opts: { userId: string; companyId: string | null; result: PointA; aiStatus: 'processing' | 'none' },
): Promise<StoreResult> {
  const { userId, companyId, result } = opts
  const { data: currentRows, error: currentErr } = await db
    .from('diagnostics')
    .select('id')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('calculated_at', { ascending: false })
  if (currentErr) {
    console.error('[point-a/store] current lookup failed', currentErr.code ?? '', currentErr.message ?? '')
    return { ok: false, error: 'lookup' }
  }
  const retiredIds = ((currentRows ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (retiredIds.length) {
    const { error: retireErr } = await db.from('diagnostics').update({ is_current: false }).eq('user_id', userId).in('id', retiredIds)
    if (retireErr) {
      console.error('[point-a/store] retire failed', retireErr.code ?? '', retireErr.message ?? '')
      return { ok: false, error: 'retire' }
    }
  }

  const { data: diag, error: diagErr } = await db
    .from('diagnostics')
    .insert({
      user_id: userId,
      company_id: companyId,
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
      ai_status: opts.aiStatus,
    })
    .select()
    .single()

  if (diagErr || !diag) {
    console.error('[point-a/store] insert failed', diagErr?.code ?? '', diagErr?.message ?? '')
    // The user must not lose their Point A.
    if (retiredIds[0]) {
      const { error: restoreErr } = await db.from('diagnostics').update({ is_current: true }).eq('user_id', userId).eq('id', retiredIds[0])
      if (restoreErr) console.error('[point-a/store] restore failed', restoreErr.code ?? '', restoreErr.message ?? '')
    }
    return { ok: false, error: 'insert' }
  }
  return { ok: true, diag: diag as Record<string, unknown> & { id: string } }
}

/**
 * The paid AI fan-out after a recalculation: the full Point A analysis and
 * the Point B strategic bridge, each with a signed internal token bound to its
 * path, the user and the diagnostic. `baseUrl` must be a trusted origin
 * (lib/internal-auth.ts internalBaseUrl), never the request Host.
 */
export function fireAiFanOut(opts: { baseUrl: string; diagnosticId: string; userId: string; locale: string }): void {
  const { baseUrl, diagnosticId, userId, locale } = opts
  for (const path of ['/api/v1/diagnostics/ai-analyze', '/api/v1/diagnostics/point-b/ai-generate']) {
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: internalFetchHeaders({}, { path, userId, diagnosticId }),
      body: JSON.stringify({ diagnostic_id: diagnosticId, user_id: userId, locale }),
    }).catch((err) => console.error(`[point-a] fan-out ${path} failed:`, err instanceof Error ? err.message : err))
  }
}

/** The diagnostic pipeline (metrics → quality → benchmarks → hypotheses → recommendations), never blocking. */
export function startDiagnosticPipeline(opts: { companyId: string; diagnosticId: string; requestedBy: string; trigger: 'manual' | 'event'; reason: string }): void {
  void runInBackground('diagnostic-orchestrator', async () => {
    try {
      const { enqueueAgentTask } = await import('@/lib/agents/queue')
      await enqueueAgentTask({
        agentKey: 'diagnostic_orchestrator',
        companyId: opts.companyId,
        trigger: opts.trigger,
        triggerRef: 'recalculate',
        requestedBy: opts.requestedBy,
        input: { action: 'start', trigger: opts.trigger, reason: opts.reason },
        idempotencyKey: `recalc:${opts.diagnosticId}`,
      })
    } catch (err) {
      console.error('[point-a] diagnostic pipeline not started:', err instanceof Error ? err.message : err)
    }
  })
}
