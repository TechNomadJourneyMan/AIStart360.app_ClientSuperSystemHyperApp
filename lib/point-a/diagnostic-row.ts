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
import { runInBackground, trackBackground } from '@/lib/background'

export type StoreResult =
  | { ok: true; diag: Record<string, unknown> & { id: string } }
  | { ok: false; error: string }

/**
 * Retire the current row(s) of the user, insert `result` as current; on a failed insert put the previous one back.
 * `preliminary` (the full questionnaire is not sent yet, PO 2026-11-02): no
 * score, health, stage or block scores in the row — only findings.
 */
export async function storeCurrentDiagnostic(
  db: SupabaseClient,
  opts: { userId: string; companyId: string | null; result: PointA; aiStatus: 'processing' | 'none'; preliminary?: boolean },
): Promise<StoreResult> {
  const { userId, companyId, result } = opts
  const p = opts.preliminary === true
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
      overall_score: p ? null : result.overall_score,
      health_index: p ? null : result.health_index,
      stage: p ? null : result.stage,
      finance_score: p ? null : result.blocks.finance,
      marketing_score: p ? null : result.blocks.marketing,
      operations_score: p ? null : result.blocks.operations,
      strategy_score: p ? null : result.blocks.strategy,
      sales_score: p ? null : result.blocks.sales,
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
 * BE-13: how long the fan-out waits for each call. The AI analysis route answers when its model
 * calls are done; with the AI deadline (45 s per call chain, lib/ai/providers/failover.ts) and the
 * route's own deadline (lib/runtime/deadline.ts) it never needs more than ~2 minutes.
 * POINT_A_FAN_OUT_TIMEOUT_MS overrides it.
 */
export const FAN_OUT_TIMEOUT_MS = 150_000

const FAN_OUT_PATHS = ['/api/v1/diagnostics/ai-analyze', '/api/v1/diagnostics/point-b/ai-generate'] as const

type FanOutOpts = { baseUrl: string; diagnosticId: string; userId: string; locale: string }

export interface FanOutDeps {
  fetchImpl?: typeof fetch
  /** Default trackBackground: a shutdown waits for the calls. */
  track?: (work: Promise<unknown>) => void
  /** Default: ai_status 'processing' → 'failed' on the row the call was for. */
  markFailed?: (path: string, opts: FanOutOpts, reason: string) => Promise<void>
  log?: (line: string) => void
  timeoutMs?: number
}

/**
 * A call that did not succeed leaves the status it was started with ('processing') behind, and
 * the client polls it forever. Only a row still 'processing' is changed: a route that finished in
 * the meantime ('completed' / 'failed' / 'none') keeps its own answer.
 */
async function markFanOutFailed(path: string, opts: FanOutOpts): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase-service')
  const db = createServiceClient()
  const { error } = path === FAN_OUT_PATHS[0]
    ? await db.from('diagnostics').update({ ai_status: 'failed' })
      .eq('id', opts.diagnosticId).eq('user_id', opts.userId).eq('ai_status', 'processing')
    : await db.from('point_b_analysis').update({ ai_status: 'failed' })
      .eq('diagnostic_id', opts.diagnosticId).eq('is_current', true).eq('ai_status', 'processing')
  if (error) throw new Error(error.code ?? 'update failed')
}

function fanOutTimeoutMs(): number {
  const raw = Number(process.env.POINT_A_FAN_OUT_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : FAN_OUT_TIMEOUT_MS
}

/**
 * The paid AI fan-out after a recalculation: the full Point A analysis and
 * the Point B strategic bridge, each with a signed internal token bound to its
 * path, the user and the diagnostic. `baseUrl` must be a trusted origin
 * (lib/internal-auth.ts internalBaseUrl), never the request Host.
 *
 * BE-13: each call has a timeout, is tracked as background work (a redeploy waits for it), and a
 * call that fails — a non-2xx answer, a network error, the timeout — marks its status 'failed' so
 * the client stops showing «ИИ анализирует…» and offers a retry. Never throws, never rejects.
 */
export function fireAiFanOut(opts: FanOutOpts, deps: FanOutDeps = {}): void {
  const { baseUrl, diagnosticId, userId, locale } = opts
  const doFetch = deps.fetchImpl ?? fetch
  // Tracking is best effort: it must never make the caller (a recalculation) fail.
  const track = deps.track ?? ((work: Promise<unknown>) => { try { trackBackground(work) } catch { /* untracked */ } })
  const markFailed = deps.markFailed ?? ((path: string, o: FanOutOpts) => markFanOutFailed(path, o))
  const log = deps.log ?? ((line: string) => console.error(line))
  const timeoutMs = deps.timeoutMs ?? fanOutTimeoutMs()
  for (const path of FAN_OUT_PATHS) {
    const work = (async () => {
      let reason: string | null = null
      try {
        const res = await doFetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: internalFetchHeaders({}, { path, userId, diagnosticId }),
          body: JSON.stringify({ diagnostic_id: diagnosticId, user_id: userId, locale }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) reason = `http_${res.status}`
        await res.body?.cancel().catch(() => {})
      } catch (err) {
        const name = (err as { name?: unknown } | null)?.name
        reason = typeof name === 'string' && name ? name : 'Error'
      }
      if (!reason) return
      // Ids and a reason code only: the body may echo client data.
      log(`[point-a] fan-out ${path} failed (${reason}) for diagnostic ${diagnosticId}`)
      try {
        await markFailed(path, opts, reason)
      } catch (err) {
        log(`[point-a] fan-out ${path}: could not mark failed: ${err instanceof Error ? err.message : 'error'}`)
      }
    })()
    track(work)
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
