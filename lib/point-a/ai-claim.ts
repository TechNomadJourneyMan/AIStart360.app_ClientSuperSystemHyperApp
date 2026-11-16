/**
 * lib/point-a/ai-claim.ts — who may start the AI analysis of a diagnostics row,
 * and when «готовится» is over (ревью R3-PA H1 / M1).
 *
 *   claim   ONE atomic compare-and-swap UPDATE turns the row to 'processing'
 *           (ai_started_at = now) only from the state it was read in: two
 *           clicks / two tabs / a script cannot start two paid analyses of one
 *           row. Refused: an analysis in progress (not stale), a complete one
 *           (only staff may regenerate it, explicitly), a retry within the
 *           cooldown after the last start.
 *   stale   'processing' older than AI_STALE_AFTER_MS (a lost call: network,
 *           a redeploy / OOM of the server mid-analysis) is a failure with
 *           ai_error 'stale': the view shows «Повторить», the page stops
 *           polling fast. Persisted by the page read (the viewer's own row) and
 *           by the agents maintenance loop (/api/cron/agents) for every row.
 *
 * Start time: ai_started_at (migration 150), else the row's calculated_at (the
 * snapshot inserts a new row already 'processing'). Before migration 150 the
 * claim compares the status only. `db` is the service role (diagnostics has no
 * UPDATE policy for API roles); the caller has checked who may act.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumn } from './ai-columns'

/** ai-analyze answers within ~2 min (route deadline 120 s, fan-out 150 s): 15 min is certainly lost. */
export const AI_STALE_AFTER_MS = 15 * 60_000
/** «Повторить» again only this long after the last start. */
export const AI_RETRY_COOLDOWN_MS = 3 * 60_000
export const AI_STALE_CODE = 'stale'

export interface AiRowState {
  ai_status?: unknown
  ai_started_at?: unknown
  calculated_at?: unknown
}

function ms(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** When the current attempt started: ai_started_at, else the row's creation (calculated_at). */
export function aiStartedMs(row: AiRowState): number | null {
  return ms(row.ai_started_at) ?? ms(row.calculated_at)
}

/** 'processing' for longer than AI_STALE_AFTER_MS. */
export function isAiStale(row: AiRowState, now: number = Date.now()): boolean {
  if (row.ai_status !== 'processing') return false
  const t = aiStartedMs(row)
  return t !== null && now - t > AI_STALE_AFTER_MS
}

export type ClaimRefusal = 'processing' | 'completed' | 'cooldown' | 'not_found' | 'error'
export type ClaimDecision = { claim: true } | { claim: false; reason: ClaimRefusal; retryInMs?: number }

/** Pure: may this row be started now? */
export function claimDecision(row: AiRowState | null, opts: { now?: number; allowCompleted?: boolean; cooldownMs?: number } = {}): ClaimDecision {
  if (!row) return { claim: false, reason: 'not_found' }
  const now = opts.now ?? Date.now()
  const status = row.ai_status ?? 'none'
  if (status === 'processing' && !isAiStale(row, now)) return { claim: false, reason: 'processing' }
  if (status === 'completed' && !opts.allowCompleted) return { claim: false, reason: 'completed' }
  // A stale attempt is over — no cooldown on top of 15 minutes; otherwise wait after the last start.
  if (status !== 'processing') {
    const started = ms(row.ai_started_at)
    const cooldown = opts.cooldownMs ?? AI_RETRY_COOLDOWN_MS
    if (started !== null && now - started < cooldown) return { claim: false, reason: 'cooldown', retryInMs: cooldown - (now - started) }
  }
  return { claim: true }
}

export type ClaimResult = { ok: true } | { ok: false; reason: ClaimRefusal; retryInMs?: number }

/**
 * Read the row, decide, and turn it to 'processing' with ONE conditional
 * UPDATE (the status and the start time it was read with): 0 rows → somebody
 * else claimed it first → refused as 'processing'.
 */
export async function claimAiAnalysis(
  db: SupabaseClient,
  target: { diagnosticId: string; userId: string },
  opts: { now?: Date; allowCompleted?: boolean; cooldownMs?: number } = {},
): Promise<ClaimResult> {
  const now = opts.now ?? new Date()
  const read = (cols: string) => db.from('diagnostics').select(cols).eq('id', target.diagnosticId).eq('user_id', target.userId).maybeSingle()
  let pre150 = false
  let res = await read('ai_status, ai_started_at, calculated_at')
  if (res.error && isMissingColumn(res.error)) {
    pre150 = true
    res = await read('ai_status, calculated_at')
  }
  if (res.error) return { ok: false, reason: 'error' }
  const row = (res.data as AiRowState | null) ?? null
  const d = claimDecision(row, { now: now.getTime(), allowCompleted: opts.allowCompleted, cooldownMs: opts.cooldownMs })
  if (!d.claim) return { ok: false, reason: d.reason, ...(d.retryInMs !== undefined ? { retryInMs: d.retryInMs } : {}) }

  let q = db.from('diagnostics')
    .update(pre150 ? { ai_status: 'processing' } : { ai_status: 'processing', ai_started_at: now.toISOString() })
    .eq('id', target.diagnosticId).eq('user_id', target.userId)
  // Compare-and-swap: the state it was read in.
  q = row!.ai_status === null || row!.ai_status === undefined ? q.is('ai_status', null) : q.eq('ai_status', String(row!.ai_status))
  if (!pre150) q = row!.ai_started_at === null || row!.ai_started_at === undefined ? q.is('ai_started_at', null) : q.eq('ai_started_at', toIso(row!.ai_started_at))
  const upd = await q.select('id')
  if (upd.error) return { ok: false, reason: 'error' }
  return (upd.data as unknown[] | null)?.length ? { ok: true } : { ok: false, reason: 'processing' }
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

/**
 * Fail the stale 'processing' rows (ai_error 'stale'): all of them (the
 * maintenance loop), or one diagnostic (the page that found it). Returns how
 * many rows changed; never throws.
 */
export async function failStaleAiAnalyses(db: SupabaseClient, opts: { diagnosticId?: string; now?: Date } = {}): Promise<number> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - AI_STALE_AFTER_MS).toISOString()
  try {
    let q = db.from('diagnostics').update({ ai_status: 'failed', ai_error: AI_STALE_CODE })
      .eq('ai_status', 'processing')
      .or(`ai_started_at.lt.${cutoff},and(ai_started_at.is.null,calculated_at.lt.${cutoff})`)
    if (opts.diagnosticId) q = q.eq('id', opts.diagnosticId)
    let res = await q.select('id')
    if (res.error && isMissingColumn(res.error)) {
      // Before migration 150: by the row's age, the status only.
      let p = db.from('diagnostics').update({ ai_status: 'failed' }).eq('ai_status', 'processing').lt('calculated_at', cutoff)
      if (opts.diagnosticId) p = p.eq('id', opts.diagnosticId)
      res = await p.select('id')
    }
    if (res.error) {
      console.error('[point-a/ai] stale sweep failed', res.error.code ?? '')
      return 0
    }
    return (res.data as unknown[] | null)?.length ?? 0
  } catch (err) {
    console.error('[point-a/ai] stale sweep failed', err instanceof Error ? err.message : err)
    return 0
  }
}

/** The client's sentence for a refused «Повторить». */
export function claimRefusalText(r: { reason: ClaimRefusal; retryInMs?: number }): { status: number; error: string } {
  switch (r.reason) {
    case 'processing': return { status: 409, error: 'Разбор уже готовится — обновите страницу через минуту-две' }
    case 'completed': return { status: 409, error: 'Разбор уже готов — повторная генерация не нужна' }
    case 'cooldown': {
      const min = Math.max(1, Math.ceil((r.retryInMs ?? AI_RETRY_COOLDOWN_MS) / 60_000))
      return { status: 429, error: `Разбор только что запускался — повторить можно через ${min} мин` }
    }
    case 'not_found': return { status: 404, error: 'Диагностика не найдена' }
    default: return { status: 500, error: 'Не удалось перезапустить разбор' }
  }
}
